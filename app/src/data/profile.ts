// Identity + about + socials, migrated verbatim from the legacy site (00-webiste-original).

export const profile = {
  name: 'Rohan Cheeniyil',
  tagline: 'Software Engineer · Networking Programmer · Hobbyist',
  about: [
    "I'm a programmer with a BS in computer engineering and a knack for tinkering. My projects have a wide scope, from art to PCB design. Documentation for some of the more interesting ones can be found below.",
    "Originally from California, I worked at L3Harris in Utah for 3 years, building an embedded networking service that interfaced with an FPGA. For 4 years now I've been on a Network Telemetry team at AWS in Seattle, where I built a data-plane flow telemetry system that moves trillions of records per second through a highly optimized data pipeline. Built to span every data-plane team in the org, it's now live on 11 of 14 fleets. The operational tooling on top has become an org mainstay, opening the door to a ClickHouse data lake that reveals aspects of the network we'd never seen before.",
    "Outside of work, you'll usually find me building projects, learning something new to improve my house, or traveling.",
  ],
};

export type Social = { label: string; href: string };

export const socials: Social[] = [
  { label: 'GitHub', href: 'https://github.com/drakumus' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/rohan-cheeniyil-095602100/' },
  { label: 'Instagram', href: 'https://www.instagram.com/rohanmybrohan/' },
  { label: 'Discord', href: 'https://discordapp.com/users/135244717901348864/' },
];
