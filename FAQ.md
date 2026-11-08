



## Dedicated hardware?
Since the server needs to be running all the time, you need some dedicated hardware to run it on. If you have an old computer laying around, that is an perfect candicate for just that, however if you find it hard to set something like that up or don't have any hardware we recommend to pick up a small SBC (Single Board Computer). Examples of these are:
- Raspberry Pi
- Rock Pi
- Orange Pi

For the initial release, buy hardware that is at least 64-bit, for using raspberry pi for reference this is from Raspberry Pi 3 Model B and newer (or some revisions of older ones). If you are unsure about what to get or if what you have found will work - ask us! Also, we are working on removing this limitation, just something now for the initial release!
Now these are just a couple of examples, and if you have an hard time finding or knowing what to buy, send us a message here on github or in the discord and we will happily help you! If you include your region we can even send you links to what you could buy.

The second hand market has a lot of these SBCs for cheap, and if you have any questions or issues, feel free to ask!

## Install docker
<i>Not had time to finish this yet, will update later but until this here is a link to what I think is a more easy to follow guide then the docker official one</i>
https://www.digitalocean.com/community/tutorials/how-to-install-and-use-docker-on-debian-10


## Checking connection to internet?? 
Currently all robots require internet to reach `pool.ntp.org` to set the time correctly. With the next update we plan to include an small ntp compatible time-endpoint so that a connection to `pool.ntp.org` is not needed. 

- Gen4 (D800-D10) only have the `pool.ntp.org` dependency, we plan on fixing with next update.
- Gen3 (D3-D7) robots also need internet for an firmware made internet check. To understand how these work, please read below.

> [!NOTE]
> Gen3 robots have an firmware bound internet check to `8.8.8.8` (Google DNS). Sadly, this is not easy to disable in the firmware (we are looking into what we can do that way), however you can bypass it by rewriting 8.8.8.8 requests to your own DNS for the ip of the robot (advanced users)

## Install as an App in Home Assistant
[Home Assistant guide on "Installning a third-party app repository"](https://www.home-assistant.io/common-tasks/os/#installing-a-third-party-app-repository)

[![Open home assistant app store with link to vacuula repo](https://my.home-assistant.io/badges/supervisor_store.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fvacuula%2Fvacuula)

If you used this button, click "Add" and then you can skip to step 11!

1. Open Home Assistant page (usually [`homeassistant.local:8123`](homeassistant.local:8123)).
2. Go to `Settings` --> `Apps` (older versions it was called `Add-ons`).
3. Click on the blue `Install app` button in right bottom corner.
4. Click on the 3-dot menu in right top corner.
5. Select `Repositories` (middle option).
6. Click on the blue `Add` button in right bottom corner.
7. Enter `https://github.com/vacuula/vacuula` as the URL.
8. Click blue `Add` button in the popup - make sure it was added in the list!
9. Click on the back arrow in the top left corner and you should be back on the `App store` page.
10. Click on the 3-dot menu in right top corner and select `Check for updates` (first option).
11. Scroll until you find `Vacuula` or use the searchbar and search `Vacuula`. 
12. Click on `Vacuula` and then select `Install app`
13. Once installed, click `Start`. 
14. Once started, you can always come to this page to `Stop` or `Restart`

In the top-bar you can: 
- change configuration by clicking on `Configuration`
- View the logs by clicking on `Log`

## Install as an App in TrueNAS SCALE
[TrueNAS guide on "Installing Custom Apps"](https://apps.truenas.com/managing-apps/installing-custom-apps/)
If you are installing Vacuula Server as an Application on TrueNAS there are a couple of points to be aware of, this guide will walk you through both of them.
1. TrueNAS already uses port 80 for its own web UI. You will need to choose a custom port for VACUULA_PORT, such as 8080.
2. TrueNAS already has an Avahi mDNS Server setup which blocks Vacuula from starting its own one successfully. This can be worked around by using a custom script.

### Install the app
1. Navigate to your TrueNAS UI
2. Click `Apps` in the side Navigation
3. Click `Discover Apps`
4. Click `Custom App`
5. Fill out the fields as follows:
   1. Application Name: `vacuula`
   2. Version: Leave as the default (this is the version of the 'Custom App' template TrueNAS use, _not_ the version of Vacuula)
   3. Image Repository: `ghcr.io/vacuula/vacuula`
   4. Tag: `latest`, if 1.1.0 has been formally released. If not use the latest beta version e.g. `1.1.0-b1`
   5. Pull Policy: If you are using `latest` then `Always pull an image, even if already present on the host`. Otherwise you could also pick `Pull the image if not already present on the host`
   6. Hostname: `vacuula`
   7. Environment Variables - add the following environment variables
      1. `GEN3_PORT`: `335`, or any port that is free on your NAS
      2. `GEN4_PORT`: `3443`, or any port that is free on your NAS
      3. `VACUULA_PORT`: `8080`, or any port that is free on your NAS. This must not be `80` - the default.
      4. `GEN3_ENABLED`: `True`
      5. `GEN4_ENABLED`: `True`
      6. `MDNS_ENABLED`: `True`
   8. Host Network: `checked`, this is necessary to enable the web UI, and the other ports, to be accessible from your network
   9. Portal Configuration (This is optional, but allows click through access to the Vacuula Web UI from the TrueNAS UI)
      1. Name: `Web UI`
      2. Protocol: `HTTP`
      3. Use Node IP: `Checked`
      4. Port: `8080`, or the value you set for `VACUULA_PORT` earlier
      5. Path: `/`
   10. Add a single storage configuration, with a mount path of `/server/data`. The exact setup you want will depend on your personal preference. Do not set the type to `Tmpfs`. An example setup is as follows:
      1. Type: `Host Path`
      2. Mount Path: `/server/data`
      3. Host Path: `/mnt/myPool/dataset/vacuula`
   11. Save the application.
6. The app will likely be crashing at this point, with an error about how port 5353 is already in use. The next section will fix that error.

### Allow Vacuula to start an mDNS server
These instructions involve using Advanced TrueNAS configurations that can result in a broken TrueNAS installation. Proceed at your own risk.

We will be telling TrueNAS to modify the Avahi Service configuration to allow multiple Avahi stacks, so that Vacuula can start its own mDNS server to enable the auto discovery to work.
1. Navigate to your TrueNAS UI
2. Click on `System` > `Advanced Settings` on the side navigation
3. Scroll to the `Init/Shutdown Scripts` section
4. Click `Add`
5. Close the warning dialog.
6. Fill out the fields as follows
   1. Description: `Allow other Avahi Stacks`
   2. Type: `Command`
   3. Command: `sed -i "/disallow-other-stacks=yes/c\disallow-other-stacks=no" /etc/avahi/avahi-daemon.conf && systemctl restart avahi-daemon.service`
   4. When: `Post-Init`
   5. Enabled: `Checked`
   6. Timeout: `10`
7. Save the configuration
8. Restart your NAS (or manually run the Command in a Shell and Restart the Vacuula application)
9. At this point you should be able to access the Vacuula Web UI from your network and it should be ready for you to use the installer
