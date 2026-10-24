"""Black-box startup/upgrade tests of the complete built image.

VACUULA_TEST_IMAGE=vacuula:test python3 -m unittest discover -s tests/container -v
Set VACUULA_TEST_DOCKER='sudo -n docker' when required by the local host.
All containers and volumes have unique test-only names; no host networking or
production mounts are used. HA tests emulate mounts/options, not Supervisor.
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import time
import unittest
import uuid

IMAGE = os.environ.get("VACUULA_TEST_IMAGE")
DOCKER = shlex.split(os.environ.get("VACUULA_TEST_DOCKER", "docker"))
CAPABILITIES = ("CHOWN", "DAC_OVERRIDE", "SETUID", "SETGID", "SETPCAP", "NET_BIND_SERVICE")

LEGACY_DATA = r'''
from pathlib import Path
import hashlib,json,os,sqlite3,subprocess
root=Path('/server/data')
subprocess.run(['alembic','upgrade','f09399c9b238'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
with sqlite3.connect(root/'vacuula.db') as db:
    db.execute("INSERT INTO robot (serial,type,name) VALUES (?,?,?)",('upgrade-fixture','neato.gen3','Preserved robot'))
ssl=root/'ssl'
ssl.mkdir(exist_ok=True)
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=upgrade-fixture','-keyout',str(ssl/'privkey.pem'),'-out',str(ssl/'cert.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
maps=root/'uploads/maps/upgrade-fixture/2026-10-20T13:49:10Z'
maps.mkdir(parents=True)
(maps/'FloorMap.png').write_bytes(b'preserved map fixture')
(root/'sentinel.txt').write_bytes(b'preserved user data')
for path in sorted(root.rglob('*'),reverse=True):
    os.chown(path,0,0)
    path.chmod(0o700 if path.is_dir() else 0o600)
os.chown(root,0,0)
root.chmod(0o700)
print(json.dumps({str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and p.name not in ('vacuula.db','vacuula.log')}))
'''

SNAPSHOT = r'''
from pathlib import Path
import hashlib,json,sqlite3,os
root=Path('/server/data')
with sqlite3.connect('file:/server/data/vacuula.db?mode=ro',uri=True) as db:
    rows=db.execute('select serial,name from robot').fetchall()
    revision=db.execute('select version_num from alembic_version').fetchone()[0]
print(json.dumps({'rows':rows,'revision':revision,'files':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and not p.is_symlink() and p.name not in ('vacuula.db','vacuula.log')},'key_mode':(root/'ssl/privkey.pem').stat().st_mode&0o777,'owner':root.stat().st_uid,'status':{k:v.strip() for k,v in (line.split(':',1) for line in Path('/proc/1/status').read_text().splitlines()) if k in ('Uid','CapEff','CapBnd','NoNewPrivs')}}))
'''


@unittest.skipUnless(IMAGE, "Set VACUULA_TEST_IMAGE to test a built image")
class UpgradeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(DOCKER + ["info"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    def docker(self, *arguments, check=True):
        result = subprocess.run(DOCKER + list(arguments), text=True, capture_output=True, timeout=90)
        if check and result.returncode:
            self.fail(f"docker {' '.join(arguments[:3])}: {result.stderr}\n{result.stdout}")
        return result

    def setUp(self):
        self.prefix = "vacuula-upgrade-test-" + uuid.uuid4().hex[:12]
        self.volume = self.new_volume("data")

    def new_volume(self, suffix):
        name = self.prefix + "-" + suffix
        self.docker("volume", "create", name)
        self.addCleanup(self.docker, "volume", "rm", name, check=False)
        return name

    def root_python(self, code, extra_mounts=()):
        return self.docker("run", "--rm", "--network", "none", "--entrypoint", "python",
                           "-v", self.volume + ":/server/data", *extra_mounts, IMAGE, "-c", code)

    def legacy(self):
        return json.loads(self.root_python(LEGACY_DATA).stdout)

    def start(self, *, readonly_data=False, missing_cap=None, options_volume=None, user=None):
        name = self.prefix + "-server"
        arguments = ["run", "-d", "--name", name, "--network", "none", "--read-only",
                     "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777",
                     "--security-opt", "no-new-privileges:true", "--cap-drop", "ALL",
                     "--pids-limit", "128", "--cpus", "2", "-e", "GEN3_ENABLED=False",
                     "-e", "GEN4_ENABLED=False", "-e", "MDNS_ENABLED=False",
                     "-v", self.volume + ":/server/data" + (":ro" if readonly_data else "")]
        for capability in CAPABILITIES:
            if capability != missing_cap:
                arguments += ["--cap-add", capability]
        if options_volume:
            arguments += ["-v", options_volume + ":/data:ro"]
        if user:
            arguments += ["--user", user, "-e", "VACUULA_PORT=8080"]
        self.docker(*arguments, IMAGE)
        self.addCleanup(self.docker, "rm", "-f", name, check=False)
        return name

    def ready(self, container, port=80):
        code = f"import urllib.request,json; print(json.dumps(json.load(urllib.request.urlopen('http://127.0.0.1:{port}/api/server',timeout=1))))"
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            result = self.docker("exec", "--user", "10001:10001", container, "python", "-c", code, check=False)
            if result.returncode == 0:
                return json.loads(result.stdout)
            state = self.docker("inspect", "--format", "{{.State.Status}}", container).stdout.strip()
            if state == "exited":
                break
            time.sleep(0.2)
        self.fail(self.docker("logs", container).stdout + self.docker("logs", container).stderr)

    def snapshot(self, container):
        result = self.docker("exec", "--user", "10001:10001", container, "python", "-c", SNAPSHOT)
        return json.loads(result.stdout)

    def assert_preserved(self, container, before):
        current = self.snapshot(container)
        self.assertEqual(current["rows"], [["upgrade-fixture", "Preserved robot"]])
        self.assertEqual(current["revision"], "5fe01baecb7b")
        for path, digest in before.items():
            self.assertEqual(current["files"][path], digest, path)
        self.assertEqual(current["key_mode"], 0o600)
        self.assertEqual(current["owner"], 10001)
        self.assertEqual(current["status"]["Uid"].split(), ["10001"] * 4)
        self.assertEqual(int(current["status"]["CapEff"], 16), 1 << 10)
        self.assertEqual(int(current["status"]["CapBnd"], 16), 1 << 10)
        self.assertEqual(current["status"]["NoNewPrivs"], "1")

    def test_legacy_root_volume_upgrades_without_manual_commands_and_restarts(self):
        before = self.legacy()
        name = self.start()
        self.ready(name)
        self.assert_preserved(name, before)
        self.docker("restart", name)
        self.ready(name)
        self.assert_preserved(name, before)
        logs = self.docker("logs", name)
        self.assertIn("updated 0 ownership entries", logs.stderr)

    def test_fresh_volume_starts(self):
        name = self.start()
        self.ready(name)
        current = self.snapshot(name)
        self.assertEqual(current["rows"], [])
        self.assertEqual(current["owner"], 10001)
        self.assertEqual(current["key_mode"], 0o600)
        web = "import re,urllib.request,urllib.parse; origin='http://127.0.0.1'; page=urllib.request.urlopen(origin+'/'); assert page.status==200; html=page.read().decode(); assert '<html' in html.lower(); script=re.search(r'src=\"([^\"]+\\.js)\"',html).group(1); asset=urllib.request.urlopen(urllib.parse.urljoin(origin+'/',script)); assert asset.status==200; assert 'javascript' in asset.headers['Content-Type']"
        self.docker("exec", "--user", "10001:10001", name, "python", "-c", web)

    def test_partially_migrated_volume_recovers(self):
        before = self.legacy()
        self.root_python("import os; os.chown('/server/data/ssl',10001,10001); os.chown('/server/data/ssl/cert.pem',10001,10001)")
        name = self.start()
        self.ready(name)
        self.assert_preserved(name, before)

    def test_ha_mounts_private_options_without_modifying_supervisor_data(self):
        before = self.legacy()
        options = self.new_volume("options")
        setup = "from pathlib import Path; import json,os; p=Path('/data'); p.chmod(0o700); f=p/'options.json'; f.write_text(json.dumps({'VACUULA_PORT':8080,'HOST_IP':'127.0.0.1'})); f.chmod(0o600); os.chown(f,0,0)"
        self.root_python(setup, ("-v", options + ":/data"))
        name = self.start(options_volume=options)
        self.ready(name, 8080)
        self.assert_preserved(name, before)
        # The selected API port proves the server read these options. Inspect
        # the private copy without requiring access to /proc/1/environ.
        check = "import os,json; from pathlib import Path; paths=list(Path('/tmp').glob('vacuula-options-*/options.json')); assert len(paths)==1; p=paths[0]; assert p.stat().st_uid==10001; assert p.stat().st_mode&0o777==0o600; assert p.parent.stat().st_mode&0o777==0o700; assert json.loads(p.read_bytes())['VACUULA_PORT']==8080; assert not os.access('/data/options.json',os.R_OK)"
        self.docker("exec", "--user", "10001:10001", name, "python", "-c", check)
        verify = "from pathlib import Path; p=Path('/data/options.json'); assert p.stat().st_uid==0; assert p.stat().st_mode&0o777==0o600"
        self.root_python(verify, ("-v", options + ":/data:ro"))

    def test_symlinks_are_not_followed_during_ownership_migration(self):
        before = self.legacy()
        # /etc/passwd belongs to the image, not this application's data volume.
        self.root_python("from pathlib import Path; (Path('/server/data')/'external-link').symlink_to('/etc/passwd')")
        name = self.start()
        self.ready(name)
        self.assert_preserved(name, before)
        self.docker("exec", "--user", "10001:10001", name, "python", "-c",
                    "from pathlib import Path; assert Path('/etc/passwd').stat().st_uid==0; assert Path('/server/data/external-link').is_symlink()")

    def test_readonly_legacy_volume_fails_before_starting_server(self):
        self.legacy()
        name = self.start(readonly_data=True)
        result = self.docker("wait", name)
        self.assertNotEqual(result.stdout.strip(), "0")
        logs = self.docker("logs", name)
        self.assertIn("Server not started", logs.stderr)

    def test_missing_chown_capability_fails_before_starting_server(self):
        self.legacy()
        name = self.start(missing_cap="CHOWN")
        self.assertNotEqual(self.docker("wait", name).stdout.strip(), "0")
        self.assertIn("Server not started", self.docker("logs", name).stderr)

    def test_missing_dac_capability_can_recover_on_next_start(self):
        before = self.legacy()
        name = self.start(missing_cap="DAC_OVERRIDE")
        self.assertNotEqual(self.docker("wait", name).stdout.strip(), "0")
        self.assertIn("Server not started", self.docker("logs", name).stderr)
        self.docker("rm", name)
        name = self.start()
        self.ready(name)
        self.assert_preserved(name, before)

    def test_multiply_linked_legacy_files_are_not_chowned(self):
        self.legacy()
        self.root_python("import os; os.link('/server/data/sentinel.txt','/server/data/hardlink')")
        name = self.start()
        self.assertNotEqual(self.docker("wait", name).stdout.strip(), "0")
        self.assertIn("multiply-linked", self.docker("logs", name).stderr)
        self.root_python("from pathlib import Path; assert Path('/server/data/sentinel.txt').stat().st_uid==0")


if __name__ == "__main__":
    unittest.main()
