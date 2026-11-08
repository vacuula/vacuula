[buymeacoffee]: https://www.buymeacoffee.com/philip2809
[buymeacoffee-shield]: https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png

<div align="center">
  <img alt="Vacuula Logo" src="./pics/logo.svg" width="250">
  <h1>Vacuula</h1>
</div>

<div align="center">

_custom server for the undead robot vacuum cleaners_

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/V7V61PBIY6)
[![Buy me a coffee][buymeacoffee-shield]][buymeacoffee]

  <h2>
      <a href="https://discord.gg/PAgwhWvyD8">
        Discord
      </a>
      <span> | </span>
      <a href="#repair-my-robot" style="font-size:32px">
        Repair my robot!
      </a>
      <!-- <span> | </span>
      <a href="https://tools.vacuula.phma.dev">
        Vacuula Tools
      </a> -->
</div>

> Vacuula is made as an all-in-one solution to repair and control your broken Neato Robot vacuum. 

- Gen1 - No wifi
- Gen2 - BotVac Connected ❌ (not yet, on the todo ⏱️)
- Gen3 - D3 ✅ D4 ✅ D5 ✅ D6 ✅ D7 ✅
- Gen4 - D800 ✅ D8 ✅ D9 ✅ D10 ✅

<i>Your robot not listed here? Get in touch!</i>
<br><i>¹Sadly we were not able to fit the OG BotVac Connected into the initial release, sorry about this, support for this robot is in the works and here very soon!</i>

![Vacuula webapp](pics/showcase.png)

| Feature          | Status               |   | Feature                | Status |
|------------------|----------------------|---|------------------------|--------|
| Setup/Status     | ✅                   |   | Notifications          | 🚧     |
| Maps             | ✅                   |   | Home Assistant Entity  | 🚧     |
| Historical runs  | ✅                   |   | Drag to clean "here"   | 🚧     |
| Schedule         | ✅                   |   | Custom sounds          | 🚧     |
| Settings         | ✅                   |   | QoL improvements       | 🚧     |
| Zones/NoGo Lines | ✅                   |   | "Next day" Schedule    | 🚧     |
| MultiZones       | Gen4 ✅ Gen2/Gen3 🚧 |   |                        |        |

> [!NOTE]
> Do you have a Gen4 robot that is in "<span style="color: #A020F0;">r</span><span style="color: #802DF6;">a</span><span style="color: #6037FA;">i</span><span style="color: #403FFD;">n</span><span style="color: #2044FE;">b</span><span style="color: #0047FF;">o</span><span style="color: #3C3EE6;">w</span> <span style="color: #7839D2;">m</span><span style="color: #AA37BE;">o</span><span style="color: #D23AAF;">d</span><span style="color: #FF3FA4;">e</span>"? Different colors flashing and the robot does not start? Contact us in the [discord](https://discord.gg/PAgwhWvyD8). There we can help you repair your robot!


# Repair my robot!

For the repair there are two parts
1. [Set up a server](#set-up-server) <i>(we are looking into a community server, however, that is not done in time for initial release, so you will need to set a server up)</i>
2. [Configure the robot](#configure-the-robot)

## Set up server

Since the server needs to always be on to work properly, you need some dedicated hardware for it. If you do not already have something to run the server on, please read about [hardware in the FAQ.](./FAQ.md#dedicated-hardware)

There are many ways to set this server up. If you are using Home Assistant, we recommend using the App Store repo we made, if not using Home Assistant, then Docker Compose is recommended.
We provide you with a couple of ways to set up the server
- [Docker Compose (see below)](#docker-compose)
- As an App in Home Assistant
  - [![Open home assistant app store with link to vacuula repo](https://my.home-assistant.io/badges/supervisor_store.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fvacuula%2Fvacuula)
  - [Button above not working? Click here for instructions](./FAQ.md#install-as-an-app-in-home-assistant)
- [LXC/standalone](./build/lxc/lxc.md)

### Docker Compose
1. Install Docker
    - <i>This is probably the hardest part for anyone unfamiliar with self-hosting, so we have started writing a [guide in the FAQ](./FAQ.md#install-docker)</i>
2. Download [`docker-compose.yaml`](https://github.com/vacuula/vacuula/releases/latest/download/docker-compose.yaml) or run `wget https://github.com/vacuula/vacuula/releases/latest/download/docker-compose.yaml` to download and save the file
3. Run `docker compose up -d`

- The server is configured by [environment variables](#configure-server)
- To see logs do `docker compose logs vacuula`
- To stop vacuula `docker compose down`
- To start vacuula `docker compose up -d`
- To update vacuula `docker compose pull`
- To permanently remove stored data `docker volume rm vacuula-data` <i>Vacuula needs to be stopped first</i>


## Configure the robot

We have made an easy to use installer to set your robot up!

> Download the latest version for your OS here

| [Windows][windows] | [Linux][linux]           | [Mac (M1 and newer)][mac-arm] | [Mac (Intel-based)][mac-intel] |
|--------------------|--------------------------|-------------------------------|--------------------------------|
| Win 10, Win 11     | Yes (need dialout)       |                               | 13.7.8, 15.4                   |
| Gen3, Gen4         | Gen3, Gen4               | (Gen4 will not work)          | Gen3 (Gen4 does not work)      |

- <i>Download by clicking the os link, table shows tested/verified systems</i>
- <i>Linux: run `sudo usermod -aG dialout $USER` to give your user dialout, then reboot your computer!</i>

[windows]:   https://github.com/vacuula/installer/releases/latest/download/VacuulaInstaller-windows.exe
[linux]:     https://github.com/vacuula/installer/releases/latest/download/VacuulaInstaller-linux.AppImage
[mac-arm]:   https://github.com/vacuula/installer/releases/latest/download/VacuulaInstaller-macos-arm64.zip
[mac-intel]: https://github.com/vacuula/installer/releases/latest/download/VacuulaInstaller-macos-intel.zip

<i>Source code is available at https://github.com/vacuula/installer</i>
<br><i>If you have a more exotic setup and cannot run this installer in any way - get in touch and we will figure something out!</i>


## Configure server
### Ports used by default
| Port | Option       | Used by                                                    |
|------|--------------|------------------------------------------------------------|
| 8050 | VACUULA_PORT | Server, Webapp, Installer. (HTTP, reverse proxy for HTTPS) |
| 335  | GEN3_PORT    | Gen3 robots, D3-D7                                         |
| 3443 | GEN4_PORT    | Gen4 robots, D8-D10                                        |

<i>The installer instructs the robot what port it should connect to. If you want to use HTTPS for the Webapp, please put the Webapp (default port 80) behind a reverse proxy. Other ports cannot be reverse provied.</i>

### Configuration
| Option       | Default | Info                                                                                                                |
|--------------|---------|---------------------------------------------------------------------------------------------------------------------|
| GEN3_PORT    | 335     | Default port the Gen3 robots will connect to the server on                                                          |
| GEN4_PORT    | 3443    | Default port the Gen4 robots will connect to the server on                                                          |
| VACUULA_PORT | 8050    | Default port that you can reach the webapp/api on                                                                   |
| GEN3_ENABLED | True    | If server should support for Gen3 robots                                                                            |
| GEN4_ENABLED | True    | If server should support for Gen4 robots                                                                            |
| MDNS_ENABLED | True    | If server should run MDNS for auto-discovering                                                                      |
| TZ           | Etc/UTC | If timezone of computer cannot get fetched, please set this to the correct timezone for schedules to work correctly |
| HOST_IP      | 0.0.0.0 | What IP the Vacuula server hosts to, useful if you have multiple IP addresses                                       |
| LOG_LEVEL    | info    | debug|info|warning|error                                                                                            |

### Platform architecture
We have currently only tested and verified on `ARM 64-bit` and `x86 64-bit`. However, we want the server to support at least `ARM 32-bit` and possibly `x86 32-bit` as well. We are looking into what we can do to make sure these platforms are also supported. The main reason behind wanting to support them is that the server can run on older SBCs. 
