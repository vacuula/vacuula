[buymeacoffee]: https://www.buymeacoffee.com/philip2809
[buymeacoffee-shield]: https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png

<div align="center">
  <img alt="Vacuula Logo" src="https://github.com/vacuula/vacuula/raw/main/pics/logo.svg" width="250">
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
      <a href="https://github.com/vacuula/vacuula#repair-my-robot" style="font-size:32px">
        Repair my robot!
      </a>
      <!-- <span> | </span>
      <a href="https://tools.vacuula.phma.dev">
        Vacuula Tools
      </a> -->
</div>

> Vacuula is made as an all-in-one solution to repair and control your broken Neato Robot vacuum. 

| Gen1    | Gen2                   | Gen3 | Gen4     |
|---------|------------------------|------|----------|
| No WiFi | BotVac Connected: WIP¹ | D3 ✅ | D800 ✅   |
|         |                        | D4 ✅ | D8     ✅ |
|         |                        | D5 ✅ | D9     ✅ |
|         |                        | D6 ✅ | D10   ✅  |
|         |                        | D7 ✅ |          |

<i>Your robot not listed here? Get in touch!</i>
<br><i>¹Sadly we were not able to fit the OG BotVac Connected into the initial release, sorry about this, support for this robot is in the works and here very soon!</i>

| Feature          | Status              |   | Feature              | Status |
|------------------|---------------------|---|----------------------|--------|
| Setup/Status     | ✅                   |   | Notifications        | 🚧     |
| Maps             | ✅                   |   | Home Assistant       | 🚧     |
| Historical runs  | ✅                   |   | Drag to clean "here" | 🚧     |
| Schedule         | ✅                   |   | Custom sounds        | 🚧     |
| Settings         | ✅                   |   | QoL improvements      | 🚧     |
| Zones/NoGo Lines | ✅                   |   | "Next day" Schedule  | 🚧     |
| MultiZones       | Gen4 ✅ Gen2/Gen3 🚧 |   |                      |        |

> [!NOTE]
> Do you have a Gen4 robot that is in "<span style="color: #A020F0;">r</span><span style="color: #802DF6;">a</span><span style="color: #6037FA;">i</span><span style="color: #403FFD;">n</span><span style="color: #2044FE;">b</span><span style="color: #0047FF;">o</span><span style="color: #3C3EE6;">w</span> <span style="color: #7839D2;">m</span><span style="color: #AA37BE;">o</span><span style="color: #D23AAF;">d</span><span style="color: #FF3FA4;">e</span>"? Different colors flashing and the robot does not start? Contact us in the [discord](https://discord.gg/PAgwhWvyD8). There we can help you repair your robot!

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
