# Equipment Catalog Sources

Public manufacturer pages only. Keep each catalog row tied to an official source URL before importing it into `universal/equipment`.

## Seed Format

- `type`: Pool equipment category used by company equipment.
- `make`: Manufacturer or brand.
- `model`: Product model/family.
- `name`: Display name for catalog selection.
- `manualPdfLink`: Direct manual PDF when available.
- `productPageUrl`: Official product page or documentation page.
- `parts`: Reusable parts copied into company equipment when selected.

## Official Source Hubs

- Pentair product catalog and manuals: https://www.pentair.com/pool-spa/products/catalog.html
- Hayward documentation/catalog pages: https://www.hayward-pool.co.uk/documentation
- Jandy product pages/downloads: https://www.jandy.com/en/products
- Raypak pool and spa documents: https://www.raypak.com/technical-resources/documents/current-documents/pool-spa-current-documents/
- Maytronics Dolphin manuals: https://manuals.maytronics.com/
- Polaris product pages and manuals: https://www.polarispool.com/en/products
- AquaCal heat pump products: https://www.aquacal.com/
- AutoPilot manuals: https://autopilot.com/manuals/
- CircuPool product manuals: https://www.circupool.com/
- CMP sanitizers: https://www.c-m-p.com/pool-products/pool-sanitizers/powerclean/

## Collection Rules

- Use official manufacturer pages, CDN links, and public manual PDFs only.
- Do not use sites that require sign-in, dealer credentials, or gated content.
- Keep `manualPdfLink` blank if a manufacturer page lists a manual but a stable public PDF URL is not verified.
- Prefer product-family records first, then add exact SKU/model variants as the catalog matures.

## First Batch Targets

- Pumps: Pentair IntelliFlo, Jandy FloPro / VS FloPro, Hayward Super Pump / TriStar.
- Filters: Jandy CV / CL, Pentair Clean & Clear Plus, Pentair FNS Plus, Hayward ProGrid.
- Heaters: Pentair MasterTemp, Jandy JXi / JXiQ, Raypak AVIA / Digital.
- Cleaners: Maytronics Dolphin lines, Polaris/Zodiac cleaners.
- Sanitizers/automation/lights/valves: add after core pump/filter/heater/cleaner records.

## Public Batch Added

- Pentair: Clean & Clear Plus, FNS Plus, IntelliChlor, IntelliCenter, GloBrite.
- Jandy: CL/CV cartridge filters, JXi/JXiQ heater manuals, AquaPure.
- Hayward: ProGrid D.E. filter, Universal H-Series, Super Pump XE, TriStar XE.
- Raypak: Digital 206A-406A, E3T.
- Polaris/Maytronics: Vac-Sweep 380, ALPHA iQ+, Dolphin robotic cleaner manual hub.
- Pentair IntelliFlo: replacement-parts sheet added for IntelliFlo VSF, IntelliFlo2 VST, and IntelliFlo VS pumps after 2018.

## Expanded Public Batch Added

- Heaters: Pentair UltraTemp / UltraTemp ETi, Jandy JE / VersaTemp, AquaCal TropiCal / Great Big Bopper.
- Cleaners: Pentair Prowler / Kreepy Krauly / Rebel, Polaris 3900 Sport / Quattro P40 / FREEDOM / ATLAS XT / MAXX.
- Chlorinators and sanitizers: Jandy TruClear / TruClear XL, Hayward AquaRite S3 / Salt & Swim 3C, AutoPilot Pool Pilot / ChlorSync, CircuPool RJ PLUS, CMP Powerclean Tab.
- Lights: Pentair MicroBrite / GloBrite Color, Jandy WaterColors / Infinite WaterColors / WaterColors Controller.
- Control systems: Pentair IntelliTouch / EasyTouch / ScreenLogic2, Hayward OmniLogic / OmniHub / OmniPL, Jandy AquaLink RS / OneTouch / Touch / PureLink.
