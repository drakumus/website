import type { Project } from '@zoci/shared';

// Portfolio content migrated verbatim from the legacy site (00-webiste-original). See site spec §3.

const sorrowCommands = `COMMANDS
NOTE:  *  means the !myrsn command was already used
------------------------------------------------------------------------- !myrsn
!myrsn [Your Runescape Name]
example: !myrsn Z0CI
Allows commands that require a name to automatically use the
name provided with this command. i.e. !exp, !log, !clanexp
------------------------------------------------------------------------- !max
!max [Runescape Name]
example:
1) !max Z0CI
2) !max  *
Tells you how much exp a person has until they are maxed
------------------------------------------------------------------------- !gdaily
!gdaily [Optional Number]
example:
1) !gdaily
2) !gdaily 15
The graphical daily command lets you see the top 10 players by
default for the daily time period (from prev ingame reset to the next).
You can also, optionally, provide a number to see up to the top 15
players. Similarly, the !gweekly and !gmonthly command exist.
If you don't like the graphic you can also use !daily but that
does not take an optional number and may have a lower default.
Reset times:
daily:  0:00 ingame time (reset)
weekly: 0:00 monday morning ingame (Sunday reset for NA)
monthly: 0:00 on the first day of the month
------------------------------------------------------------------------- !exp
!exp [Runescape Name]
Gives you your total exp gains for all time, the day, and the week.
Day implies since the last reset and week implies since the last
weekly reset.
------------------------------------------------------------------------- !canjoin
!canjoin [Runescape Name]
Lets you see a person's combat level, total level, and skill levels,
along with a message informing you if that person meets the
minimum requirements to join Sorrow Knights.
------------------------------------------------------------------------- !cantheyjoin
!cantheyjoin [Name], [Name], ... (up to 6)
Takes a list of up to 6 people and checks if their combat level or total
level are high enough to join Sorrow Knights.
------------------------------------------------------------------------- !clanexp
!clanexp [Runescape Name]
Lets you see a user's exp gained since they joined the clan.
This gets reset the second you leave the clan.
------------------------------------------------------------------------- !epeen
!epeen [Runescape Name]
Gives a full report on the size of your epeen. Provides ranking,
percentile, exp, and epeen size for daily, weekly, monthly, and total
exp gained. At the bottom are some pie charts showing your daily,
weekly, monthly, and total exp vs the rest of the clan's.
------------------------------------------------------------------------- !log
!log [Runescape Name]
Prints your adventure log if your runemetric profile is public.
------------------------------------------------------------------------- !ports
!ports [hours:minutes]
example: !ports 1:15
@s you when the specified hours and minutes timer expires.
------------------------------------------------------------------------- Event Commands
The commands !rank and !leaderboard exist. Use those to get info about
the last exp event we had.
------------------------------------------------------------------------- !compexp
!compexp [Runescape Name]
Lets you see how much exp you have left to true max.
(120 dg, invention, slayer, farming, and herblore)
Note: !compexp can be swapped out for !truemax`;

const logPortalSummary = `You have logs across 1 hr 53 mins 42 secs for today
Raid Wing 1 for 34 mins 10 secs
✅ Vale Guardian for 18 mins 5 secs (4 pulls): https://dps.report/zsvL-log_vg
✅ Gorseval the Multifarious for 3 mins 1 sec (1 pull): https://dps.report/xG79-log_gors
✅ Sabetha the Saboteur for 4 mins 43 secs (1 pull): https://dps.report/dL51-log_sab
Raid Wing 2 for 4 mins 25 secs
✅ Slothasor for 3 mins 30 secs (1 pull): https://dps.report/O8Eb-log_sloth
✅ Matthias Gabrel for 4 mins 25 secs (1 pull): https://dps.report/YQuF-log_matt
Raid Wing 3 for 15 mins 58 secs
✅ Keep Construct for 7 mins 4 secs (1 pull): https://dps.report/K2Yy-log_kc
✅ Twisted Castle for 2 mins 35 secs (1 pull): https://dps.report/4Xdz-log_tc
✅ Xera for 7 mins 59 secs (2 pulls): https://dps.report/JCSo-log_xera
Raid Wing 4 for 20 mins 20 secs
✅ Cairn the Indomitable for 3 mins (1 pull): https://dps.report/eC8c-log_cairn
✅ Mursaat Overseer for 1 min 49 secs (1 pull): https://dps.report/ncHQ-log_mo
✅ Samarog for 6 mins 14 secs (1 pull): https://dps.report/TX6l-log_sam
❌ Deimos for 5 mins 13 secs (best pull of 1 pull): https://dps.report/XSwA-log_dei`;

const projectsByDefinition: Project[] = [
  {
    id: 'ci-process',
    title: 'Website CI/CD',
    thumbnail: '/img/ci-pipeline.png',
    blurb: 'A self-deploying website built with Terraform, Docker, and GitHub Actions.',
    tags: ['Terraform', 'Docker', 'GitHub Actions', 'DigitalOcean'],
    legacy: true,
    note: 'This architecture has since been retired. The site moved to a self-hosted home-server setup, so the CI/CD pipeline described here is no longer in use.',
    body: [
      { kind: 'heading', text: 'The Project Server' },
      { kind: 'image', src: '/img/ci-droplet.png', alt: 'DigitalOcean droplet' },
      {
        kind: 'text',
        md: "Over the years I've had to spin up many a project server whether it be for hackathons or personal projects. It's always useful to have a space to run code contiguously. I eventually settled on DigitalOcean as my provider and so my first project droplet was created. This droplet lasted about a year and a half running a large Discord bot which tracked heuristics on ~500 RuneScape accounts using a MySQL, DiscordJS, NodeJS stack. Unfortunately it wasn't to last since a botnet took down the server in late 2019. Put off by the idea of spending another 15+ hours setting up a project server, I shut down the bot and let the project gather dust for a year or two, until a friend introduced me to Terraform.",
      },
      {
        kind: 'text',
        md: 'Terraform is a language that lets developers spin up code-defined servers in an automated manner. Combined with Docker it enables a CI process I could only have dreamed of 5 years ago. For personal projects, Terraform is used to:',
      },
      {
        kind: 'list',
        items: [
          'Create a Droplet on DigitalOcean with Docker preloaded on Ubuntu',
          'Add an SSH keypair between the server and local environment',
          'Create a shortcut to a MobaXterm session with the server',
          'Distribute SSH key pairs as GitHub secrets to each project repo on the server',
          'Create the DNS entries required for this website',
        ],
      },
      { kind: 'text', md: 'The resulting distributed secrets:' },
      { kind: 'image', src: '/img/ci-secrets.png', alt: 'GitHub secrets' },
      {
        kind: 'text',
        md: "Using these secrets' SSH info, project repositories are able to deploy themselves as Docker images, a process explored further below.",
      },
      { kind: 'heading', text: 'Docker and Project Structure' },
      {
        kind: 'text',
        md: "Now that a server exists and a methodology for distributing SSH info to each repo is established, it's time to tackle auto-deploying. GitHub hosts its own Docker registry which lets us publish images for our repository. With Docker Compose the solution can be packaged and deployed on our terms via a simple init script in the Dockerfile. Each of my projects follows this structure:",
      },
      {
        kind: 'list',
        items: [
          'development-docker-compose.yml',
          'prod_configs/',
          '    └ project-name/',
          '        └ release-docker-compose.yml',
          '    └ …any init scripts',
        ],
      },
      {
        kind: 'text',
        md: 'At the top level is a docker compose used entirely for development, maintained separately from prod. Inside "prod_configs" is a folder named for the project (to help with Docker artifact naming) holding the release plus any init scripts to copy into the container. Secrets can live in a .env file for development, but should go in GitHub secrets for deploying.',
      },
      { kind: 'heading', text: 'Git CI' },
      { kind: 'image', src: '/img/ci-pipeline.png', alt: 'GitHub Actions CI pipeline' },
      {
        kind: 'text',
        md: 'Most of this is self-explanatory: generate a Docker image and upload it to the git registry. The most interesting step is "deploy the container and run init scripts where necessary": it runs basic setup via bash on the remote server, using git secrets to connect and copy over the Docker image. Once that\'s done the project is deployed!',
      },
      {
        kind: 'text',
        md: "Running this job on every commit to master means I never have to worry about deploying. All the hassle of SSHing into a server to copy in a release is gone. Now it's just git add, commit, push, and it's on the internet in minutes.",
      },
    ],
    links: [
      { label: 'Terraform repo', href: 'https://github.com/drakumus/DigitalOceanDropletTerraform' },
      { label: 'Website', href: 'https://github.com/drakumus/website' },
      { label: 'Music Bot', href: 'https://github.com/drakumus/evobot-docker' },
      { label: 'Cron/utility bot', href: 'https://github.com/drakumus/ShadowRealmDiscordBot' },
    ],
  },
  {
    id: 'sorrow-bot',
    title: 'Sorrow Bot / Compscape',
    thumbnail: '/img/sorrow-bot.png',
    blurb: 'A Discord bot tracking 500 Runescape players for 4 years.',
    tags: ['DiscordJS', 'VegaJS', 'Node.js', 'MySQL'],
    body: [
      { kind: 'image', src: '/img/sorrow-bot.png', alt: 'Sorrow Bot logo' },
      {
        kind: 'text',
        md: 'Sorrow Bot, originally Compscape, was a Discord bot I started as a labor of love to get more experience with databases before getting into the industry back in 2018. It grew into a lot more and became one of my longest-supported projects, lasting a whole two years of development before being taken down by a botnet attack that compromised the MySQL backend.',
      },
      {
        kind: 'text',
        md: "The stack was DiscordJS | VegaJS | NodeJS | MySQL on an Ubuntu Server. This predated my current CI process. At some point I'll get around to updating it, but it'd sit better on a GraphQL database instead of the now-dated MySQL one.",
      },
      {
        kind: 'text',
        md: 'Below is a copy-paste of the documentation I provided on Discord, with some image examples of the commands’ output using live data:',
      },
      { kind: 'code', lang: 'text', src: sorrowCommands },
      { kind: 'heading', text: 'Example output (live data)' },
      { kind: 'image', src: '/img/rs-daily.png', alt: '!gdaily output' },
      { kind: 'image', src: '/img/rs-exp.png', alt: '!exp output' },
      { kind: 'image', src: '/img/rs-epeen1.png', alt: '!epeen output' },
      { kind: 'image', src: '/img/rs-epeen2.png', alt: '!epeen charts' },
      { kind: 'image', src: '/img/rs-log.png', alt: '!log output' },
    ],
    links: [{ label: 'Compscape repo', href: 'https://github.com/drakumus/compscape' }],
  },
  {
    id: 'ffxiv-raid-tools',
    title: 'FFXIV Raid Tools',
    thumbnail: '/img/ff14-drops.png',
    blurb: 'A loot-distribution and attendance tracker I built to run a Final Fantasy XIV static raid group.',
    tags: ['React', 'Node.js', 'MySQL', 'FFXIV'],
    legacy: true,
    note: 'A retired tool from the old server, built for a raid static I led back in 2022.',
    body: [
      {
        kind: 'text',
        md: 'For ~8 years I led raids across various MMOs, my last one being Final Fantasy XIV. This was a fixed group of 8 people completing highly coordinated content each week. With gear gated weekly across the whole group, and attendance of the same 8 people being an absolute requirement, I built this tracker to help manage the team.',
      },
      {
        kind: 'text',
        md: "As raid lead, I handled recruitment, scheduling, strategy, and loot. Each player had a distinct best-in-slot goal, so rather than rolling for drops, I assigned each piece to whoever it advanced most. The tracker made those decisions easy to reason about at a glance.",
      },
      { kind: 'heading', text: 'Loot distribution' },
      { kind: 'image', src: '/img/ff14-drops.png', alt: 'Loot distribution matrix and drop log' },
      {
        kind: 'text',
        md: "The matrix maps every gear slot (rows) against each of the eight players (columns). A check means the piece is secured, an X means it remains on that player's goal list, and the upgrade-token rows track how many crafting materials each person is still owed. When a drop occurred, I could immediately see who needed it most. The panel on the right is the running drop log, recording every award by player, item, and date.",
      },
      { kind: 'heading', text: 'Attendance' },
      { kind: 'image', src: '/img/ff14-attendance.png', alt: 'Attendance charts: by day, per-member total, and minutes late' },
      {
        kind: 'text',
        md: "Three views cover attendance: By Day charts the group's turnout each raid night across the tier, Total gives each member's overall attendance percentage, and Total Minutes Late highlights tardiness. In eight-person content, a single absence cancels the night, so this served as the reference for keeping the roster accountable.",
      },
    ],
  },
  {
    id: 'gw2-launcher',
    title: 'Guild Wars 2 Launcher',
    thumbnail: '/img/gw2-launcher.jpg',
    blurb: 'A re-creation of the classic Guild Wars 2 beta launcher, with an animated game-art backsplash and multi-account login. A decade-long personal project.',
    tags: ['Electron', 'Python', 'Flask', 'GW2'],
    body: [
      {
        kind: 'text',
        md: 'A long-running personal project for a game I had played for a decade. The Guild Wars 2 beta shipped with a distinctive launcher that played game art as an animated backsplash behind the logo. This was my re-creation of it, developed on and off over six years.',
      },
      { kind: 'heading', text: '2016: First working version' },
      { kind: 'youtube', id: 'ljn190fe09k' },
      {
        kind: 'text',
        md: 'A basic working version, with a backend that drove a headless Guild Wars 2 client. I never released it, as the backsplash did not loop cleanly.',
      },
      { kind: 'heading', text: '2020: The backsplash, done right' },
      { kind: 'youtube', id: 'K34VTzWBdxA' },
      {
        kind: 'text',
        md: 'I returned to the project and focused on the art. I learned Adobe Premiere, composited the overlay logo in Photoshop, and edited official and fan art into a 14-minute, seamlessly looping video, with scaling, tweening, and transitions timed to the music in the style of the original launcher.',
      },
      { kind: 'heading', text: '2022: The full launcher' },
      { kind: 'youtube', id: 'Ja2dcNbI6Zs' },
      {
        kind: 'text',
        md: 'The complete launcher: a Python/Flask backend and an Electron front-end, with multi-character credential management and an automated daily login across all managed accounts for passive in-game income.',
      },
      {
        kind: 'text',
        md: 'Distributing it widely proved difficult, since pairing Flask with Electron is uncommon and packaging was troublesome. It also served a fairly niche need, so it remained something I shared with close friends and used daily until I stopped playing in 2024.',
      },
    ],
    links: [{ label: 'GitHub (LoginPortal)', href: 'https://github.com/drakumus/LoginPortal' }],
  },
  {
    id: 'log-portal',
    title: 'Log Portal',
    thumbnail: '/img/log-portal.png',
    blurb: 'Automated Guild Wars 2 raid-log uploads to dps.report, with search and per-session summaries.',
    tags: ['Python', 'Automation', 'GW2', 'dps.report'],
    body: [
      {
        kind: 'text',
        md: "A large part of improving at Guild Wars 2 raiding is log analysis. Log Portal automated my uploads to dps.report (the community log server, reportedly run out of a contributor's garage), then made every log searchable and generated per-session raid summaries.",
      },
      { kind: 'video', src: '/media/log-portal-uploading.mp4', poster: '/img/log-portal-poster.jpg' },
      { kind: 'text', md: 'A session summary looked like this:' },
      { kind: 'code', lang: 'text', src: logPortalSummary },
      {
        kind: 'image',
        src: '/img/log-portal.png',
        alt: 'Log Uploader, a searchable table of 3,406 raid logs with success, health, date, and dps.report links',
      },
      {
        kind: 'text',
        md: 'I later refined it with boss icons and similar touches, though I no longer have those screenshots. If I revive my old gaming PC, I will post the latest version.',
      },
    ],
    links: [{ label: 'GitHub', href: 'https://github.com/drakumus/Log-Portal' }],
  },
  {
    id: 'raid-analyzer',
    title: 'raidAnalyzer',
    thumbnail: '/img/raid-analyzer-gantt.png',
    blurb: 'Gantt charts and Discord session summaries for a world-record raid group, surfacing downtime and gaps.',
    tags: ['Python', 'Discord', 'Data Viz', 'GW2'],
    body: [
      {
        kind: 'text',
        md: 'For one of the more competitive groups I raided with, I built a more focused tool. raidAnalyzer turned a night of logs into a Gantt chart of every boss kill, along with a summary posted to Discord, so we could see exactly where our downtime and gaps were while pushing for full-clear world records.',
      },
      {
        kind: 'image',
        src: '/img/raid-analyzer-gantt.png',
        alt: 'Weekly Clear Gantt chart of boss kills across a raid night, colored by wing',
      },
      {
        kind: 'image',
        src: '/img/raid-analyzer-discord.png',
        alt: 'Session Analyzer Discord message with a per-wing breakdown of kill times, pulls, and comp DPS',
      },
    ],
    links: [{ label: 'GitHub', href: 'https://github.com/drakumus/raidAnalyzer' }],
  },
  {
    id: 'down-to-raid',
    title: 'Down To Raid',
    thumbnail: '/img/down-to-raid.png',
    blurb: 'A Discord sign-up bot for pick-up raids: members react to fill roles, so organizers do not burn out.',
    tags: ['Discord', 'Docker', 'GW2'],
    body: [
      {
        kind: 'text',
        md: 'Running more casual content meant organizing pick-up groups (PUGs), which was tedious: roles to fill, player capabilities to balance, and all the coordination falling on a single organizer.',
      },
      {
        kind: 'image',
        src: '/img/down-to-raid.png',
        alt: 'Down To Raid Discord embed, a sign-up sheet where members react to claim roles (tank, druid, dps, quickness, alacrity, learner)',
      },
      {
        kind: 'text',
        md: 'Down To Raid turned that into an interactive sign-up sheet, with requirements listed clearly and members reacting to claim the roles they wanted. With it in use, we formed more PUGs than before without burning out organizers.',
      },
      {
        kind: 'text',
        md: 'RaidyCheck was a follow-up rewrite and my first project using Docker. As I recall, it did not add features beyond Down To Raid.',
      },
    ],
    links: [
      { label: 'DownToRaid', href: 'https://github.com/drakumus/DownToRaid' },
      { label: 'RaidyCheck', href: 'https://github.com/drakumus/RaidyCheck' },
    ],
  },
  {
    id: 'skylight',
    title: 'Skylight',
    thumbnail: '/img/skylight-photo2.jpg',
    blurb: 'A custom numpad with two rotary encoders and a window into its components, built from my own PCB, case, and firmware.',
    tags: ['PCB', 'KiCad', 'QMK', 'Embedded', 'Fusion 360'],
    body: [
      {
        kind: 'text',
        md: 'This is Skylight, a numpad with two rotary encoders using an ATMEGA32A-PU microcontroller. I designed and built it end-to-end: an OLED and a clear acrylic “skylight” that shows the electronics inside, running QMK firmware (configurable in VIA), on a PCB and case I made myself.',
      },
      { kind: 'image', src: '/img/skylight-photo2.jpg', alt: 'Skylight numpad at an angle, with white keycaps beside an exposed PCB, two aluminum knobs, and an OLED' },
      { kind: 'image', src: '/img/skylight-photo1.jpg', alt: 'Top-down view of the Skylight numpad and its PCB window' },
      { kind: 'image', src: '/img/skylight-photo3.jpg', alt: 'Underside window showing the switches and lit PCB (Skylight s2)' },
      { kind: 'heading', text: 'What went into it' },
      {
        kind: 'list',
        items: [
          'Custom PCB designed in KiCad and fabricated at JLCPCB',
          'Laser-cut acrylic and stainless-steel case modeled in Fusion 360 (cut by SendCutSend)',
          'The ATMEGA32A-PU has no native USB, so I flashed USBaspLoader (VUSB) over an ISP to make it QMK-flashable',
          'QMK firmware with VIA support for remapping keys and both encoders on the fly, without recompiling',
          'Two rotary encoders, an OLED, and per-key RGB (static only, as streaming RGB overloads the microcontroller)',
        ],
      },
      { kind: 'image', src: '/img/skylight-case.png', alt: 'Case modeled in Fusion 360' },
      { kind: 'image', src: '/img/skylight-pcb.png', alt: 'PCB layout in KiCad' },
      { kind: 'image', src: '/img/skylight-via.png', alt: 'Remapping keys in the VIA configurator' },
    ],
    links: [{ label: 'GitHub', href: 'https://github.com/drakumus/Skylight' }],
  },
  {
    id: 'school-projects',
    title: 'School Projects',
    thumbnail: '/img/school.jpg',
    blurb: 'Computer-engineering coursework: visual-light networking and a self-balancing robot.',
    tags: ['Embedded', 'C', 'C#', 'PCB', 'Controls'],
    body: [
      { kind: 'heading', text: 'Senior Project' },
      { kind: 'youtube', id: 'qG8Q75YpDy8' },
      {
        kind: 'text',
        md: 'My goal was to develop an LED controller that could sit on each individual fingertip and communicate light patterns to each other. So each LED could communicate without increasing project complexity or power requirements, the LEDs on each device were used as both senders and receivers, a concept known as visual light communications. The video shows successful visual light communication over my own UDP-based networking protocol. The repository below also includes a simple C# application using Model-View-ViewModel architecture to set lighting patterns.',
      },
      { kind: 'heading', text: 'Self-Balancing Robot' },
      { kind: 'youtube', id: '2yIC1yWF2oY' },
      {
        kind: 'text',
        md: 'A fun project where I got to 3D-print the chassis and program a 16-bit processor with a PID controller to self-correct and balance.',
      },
    ],
    links: [{ label: 'Senior Project', href: 'https://github.com/drakumus/SeniorProject' }],
  },
];

// Portfolio display order (most impressive first). Edit this list to re-sort the grid;
// any project id not listed here falls to the end.
const displayOrder = [
  'skylight',
  'sorrow-bot',
  'gw2-launcher',
  'school-projects',
  'ci-process',
  'ffxiv-raid-tools',
  'log-portal',
  'raid-analyzer',
  'down-to-raid',
];
const displayRank = (id: string) => {
  const i = displayOrder.indexOf(id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};
export const projects: Project[] = [...projectsByDefinition].sort(
  (a, b) => displayRank(a.id) - displayRank(b.id),
);
