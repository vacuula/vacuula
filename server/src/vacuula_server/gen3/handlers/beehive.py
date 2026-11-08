from __future__ import annotations
import json
import logging
from vacuula_server.constants import MAPS_DIR
from vacuula_server.gen3.data import Gen3Data
from vacuula_server.gen3.utils import get_robot_serial
from vacuula_server.gen3.map_utils import parse_session
from vacuula_server.db import get_session, db_commit
from vacuula_server.models.robot import Robot
from vacuula_server.models.persistent_map import PersistentMap
from vacuula_server.models.run import Gen3__Run
import os
from sqlalchemy import select

from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler


logger = logging.getLogger(__name__)

def post_links(req: RouterHandler) -> None:
    """POST /links - link robot to server"""
    logger.debug("New GEN3 linking from %s", req.client_address)
    if not (data := req.read_json()): return
    if not (serial := get_robot_serial(req)): return

    password: str | None = data.get("secret_key", "")
    name: str | None = data.get("name", "")

    if not password or not name:
        logger.error("Password or name missing for robot %s", serial)
        req.send_bad_request("password or name missing")
        return

    logger.debug("Linking robot %s", serial)

    if "--IV--" not in name:
        logger.error("Installer version was not sent! %s: %s", serial, name)
        req.send_bad_request("no installer version sent")
        return

    name, installed_with = name.split("--IV--", 1)

    # if serial exists, update password, else create new robot
    with get_session() as session:
        robot = session.scalar(select(Robot).where(Robot.serial == serial))
        gen3_data = session.scalar(select(Gen3Data).where(Gen3Data.robot == serial))

        if robot and gen3_data:
            logger.debug("Robot %s already exists, updating password", serial)
            gen3_data.password = password
            gen3_data.installed_with = installed_with
        else:
            logger.debug("Creating new robot %s", serial)
            robot = Robot(serial=serial, type="neato.gen3", name=name)
            gen3_data = Gen3Data(robot=serial, password=password, installed_with=installed_with)
    
        if not db_commit(session, req, robot, gen3_data):
            return

    req.send_ok()


def persistent_maps(req: RouterHandler) -> None:
    """GET /persistent_maps - list enabled persistent maps for robot"""
    if not (serial := get_robot_serial(req)): return

    with get_session() as session:
        maps = session.execute(
            select(PersistentMap.id, PersistentMap.robot)
            .where(PersistentMap.enabled == True)
            .where(PersistentMap.in_maps_list == True)
            .where(PersistentMap.robot == serial)
        ).all()

    req.send_ok([{"id": m.id} for m in maps])


def upload_init(req: RouterHandler, upload_type: Literal["maps", "logs"]) -> None:
    """POST /maps/upload_jobs - robot initiate map upload"""

    if not (data := req.read_json()): return
    if not (serial := get_robot_serial(req)): return

    map_id = data.get("group_id")
    if not map_id:
        logger.error("Upload id not defined for robot %s", serial)
        req.send_bad_request("upload id missing")
        return

    res = {
        "id": map_id,
        "post_url": "vacuula.local",
        "params": {
            "key": serial,
            "AWSAccessKeyId": upload_type,
            "acl": "vacuula-unused",
            "policy": "vacuula-unused",
            "signature": map_id,
            "Content-Type": "application/octet-stream",
            "success_action_status": "201"
        }
    }

    req.send_created(res, False)



# TODO: this happens twice for new maps, later on don't rerun the parsing for already done hash checks! 
def upload_finish(req: RouterHandler, upload_type:Literal["maps", "logs"], job_id: str) -> None:
    """PUT /maps/upload_jobs/{id} - update upload job status - robot done"""
    if not (data := req.read_json()): return

    if not job_id or upload_type not in ('maps', 'logs'):
        req.send_bad_request("params bad")
        return

    if not (serial := get_robot_serial(req)): return

    if not data.get('success'):
        logger.error("Upload failed for robot %s, job %s", serial, job_id)
        req.send_bad_request("You said upload failed?")
    
    
    # we can now close the request to robot when we are getting logs
    if upload_type == 'logs':
        req.send_created()
        return
    
    # only maps should get the extra parsing
    job_folder = f"{MAPS_DIR}/{serial}/{job_id}"
    floor_map_path = f"{job_folder}/FloorMap.png"
    manifest_path = f"{job_folder}/manifest.json"
    run_map_path = f"{job_folder}/RunMap.png"
    if not all(os.path.isfile(p) for p in [floor_map_path, manifest_path, run_map_path]):
        logger.error("Missing files for job %s", job_id)
        req.send_bad_request('files missing for upload')
        return
    
    manifest: dict
    try:
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
    except Exception:
        logger.error("Manifest read error for job %s", job_id)
        req.send_internal_error()
        return

    robot_serial_in_manifest = manifest.get("robot_serial")
    run = manifest.get("run") or {}
    run_id = run.get("id")

    if robot_serial_in_manifest != serial or run_id != job_id:
        req.send_bad_request("stuff no match")
        logger.error("Robot serial or run id mismatch for job %s: manifest serial=%s, run id=%s", job_id, robot_serial_in_manifest, run_id)
        return

    # we can now close the connection for the maps, further parsing can be done of data
    req.send_ok() # TODO: send ok for actaully closing the upload

    job_folder = f"{MAPS_DIR}/{serial}/{run_id}"
    floor_map_path = f"{job_folder}/FloorMap.png"
    run_map_path = f"{job_folder}/RunMap.png"
    manifest_path = f"{job_folder}/manifest.json"
    floormap_meta, _ = parse_session(floor_map_path, run_map_path, job_folder)

    base = (floormap_meta["dock"]["normalised_x"], floormap_meta["dock"]["normalised_y"])
    valid = run['valid_as_persistent_map']

    with get_session() as session:
        pmap = session.get(PersistentMap, run_id)
        if pmap is None:
            session.add(PersistentMap(
                id=run_id,
                robot=serial,
                name="(unnamed)",
                base=base,
                enabled=valid,
                in_maps_list=valid,
            ))
        else:
            logger.debug("Persistent map %s exists, updating", run_id)
            pmap.base = base
            # an upload during the run is not yet valid; promote once a later upload is
            if valid and not pmap.in_maps_list:
                pmap.in_maps_list = True
                pmap.enabled = True

        grun = session.get(Gen3__Run, run_id)
        if grun is None:
            session.add(Gen3__Run(
                id=run_id,
                robot=serial,
                persistent_map=run_id,
                run=run,
            ))
        else:
            grun.run = run

        session.commit()
