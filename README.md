# NetScope — Inside the Internet

An original, interactive teaching app for the **network layer** (Computer Networks, Chapter 4). You build a network on a canvas, then watch packets, routing protocols, addressing, fragmentation, ICMP and circuit switching compute their results *live on that network*.

Everything is deterministic and runs entirely in your browser. There is **no backend, no API key, and no external service** required.

---

## What it is not

- It is **not** a capture of real traffic. No Internet packets are sent or received. Latency, RTT and hop timings are **simulated** from link costs and are labelled as such wherever they appear.
- It is **not** a production protocol stack. RIP, OSPF and BGP are simplified educational models so the arithmetic stays inspectable; their simplifications are stated inside each generated report.
- Nothing is hardcoded to match an example. Every number on screen is computed from the current topology and your inputs by the shared engine in `src/core/`.

---

## Quick start

```bash
cd NetScope
npm install       # first time only

npm run dev       # local dev server → http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check (`tsc -b`) then produce a static bundle in `dist/` |
| `npm run preview` | Serve the built `dist/` bundle locally |
| `npm run test` | Run the Vitest suite (`vitest run`) |
| `npm run test:watch` | Re-run tests on change |
| `npm run lint` | Oxlint |
| `npm run typecheck` | `tsc -b` only |

### Deploying

`npm run build` emits a fully static site in `dist/`. Drop it on any static host (Netlify, GitHub Pages, an internal web server). There is no server-side code to configure.

---

## The ten modules

Reachable from the left sidebar.

| # | Module | Chapter 4 idea it teaches |
| --- | --- | --- |
| A | **Topology studio** | Build, move, connect and delete nodes; import/export JSON; presets; live structural validation. Your canvas is the network every other module simulates on. |
| B | **Packet journey** | Store-and-forward routing hop by hop: prefix test, gateway handoff, TTL, fragmentation on the wire, reassembly — animated from the real event list. |
| C | **Routing algorithms** | Link-state / Dijkstra, distance-vector, RIP, OSPF and BGP on the *same* topology, with forwarding tables and convergence traces. |
| D | **IPv4 & CIDR** | Mask, network, broadcast, usable range, the 32-bit net/host view, two-host same-subnet test, aggregation, private blocks. Worked example `192.168.10.130/26` plus `/31` and `/32` edge cases. |
| E | **Fragmentation lab** | Split a datagram across an MTU, show offset/MF/ID, compute bytes-on-wire, prove it reassembles. DF=1 and MTU-too-small cases. |
| F | **IPv6 explorer** | Expand / compress addresses, 128-bit nibble grid, prefix compare, SLAAC interface-id from MAC, the 40-byte header, IPv4-vs-IPv6. |
| G | **ICMP & traceroute** | Walk a path with rising TTL, read the replies and simulated RTTs; ping output; ICMP message types. Unreachable / filtered-router / loop scenarios. |
| H | **Virtual circuit vs datagram** | Per-call setup and VCI tables against per-packet lookup, including a mid-flight link failure. |
| I | **Challenge mode** | Addressing, forwarding, Dijkstra-cost, fragmentation and IPv6 puzzles graded **live** by the same engine — no fixed answer key. |
| J | **Experiment report** | Generate a printable / copyable / downloadable Markdown + JSON report for each experiment, built from current simulation state. |

---

## Built-in topologies

Presets in the Studio (the first is the default):

1. **Campus core** — two access routers under a core router. PC-1 and PC-2 share a `/26` (local ARP delivery) while the Web Server is remote (gateway handoff).
2. **Multi-AS Internet core** — Campus AS171 multihomed to ISP-A (AS200) and ISP-B (AS300) reaching data-centre AS400, so `LOCAL_PREF` can beat the shortest path.
3. **Failure lab (count to infinity)** — watch distance-vector react to a link failure.
4. **Chapter 4 worked example (A–E)** — the small network the textbook example runs on.
5. **MTU / fragmentation lab** — a path with a tight MTU.

---

## Worked examples (the numbers to check)

These are asserted in the test suite, so they cannot silently drift.

**Dijkstra from A over the A–E worked example** (link-state costs):

| Node | A | B | C | D | E |
| --- | --- | --- | --- | --- | --- |
| Cost | 0 | 2 | 4 | 5 | 8 |

Shortest path to E is cost **8** with first hop **B**.

**Fragmentation** — 4000 B datagram, 20 B header, 1500 B MTU:

| Fragment | Data (B) | Total (B) | Offset (×8 B) | MF |
| --- | --- | --- | --- | --- |
| 1 | 1480 | 1500 | 0 | 1 |
| 2 | 1480 | 1500 | 185 | 1 |
| 3 | 1020 | 1040 | 370 | 0 |

Offsets in bytes: 0 / 1480 / 2960. The three reassemble back to the original 3980 B of payload.

**IPv4 CIDR** — `192.168.10.130/26`: mask `255.255.255.192`, network `192.168.10.128`, broadcast `192.168.10.191`, usable `…129–…190`, **62** assignable hosts.

---

## Guided demo (about 8 minutes)

1. **Studio (Module A).** Start on *Campus core*. Switch to the **Connect** or **Router** tool and add a node; drag it; note the live node/link/router counts in the top bar and the validation line under the canvas.
2. **Packet journey (Module B).** Pick **PC-1 → Web Server** and press Play. Watch the marker cross the gateway link, then read each router's forwarding decision, the TTL decrements and the final delivery in the timeline. The badge shows `delivered`.
3. **Routing (Module C).** Toggle between Link-state, Distance-vector, RIP, OSPF and BGP; the canvas highlights the chosen tree/path and the tables update.
4. **IPv4 & CIDR (Module D).** Load the `192.168.10.130/26` worked example and read the 32-bit net/host split, then jump to the `/31` and `/32` edge cases.
5. **Fragmentation (Module E).** Keep the 4000 B / 1500 B preset and confirm the three fragments and the reassembly line.
6. **ICMP & traceroute (Module G).** Trace PC-1 → Web Server and read the per-TTL hops with simulated RTTs; switch the scenario to *unreachable* or *filtered router*.
7. **Challenges (Module I).** Solve a couple; the answers are graded against the live topology, not a stored key.
8. **Report (Module J).** Generate the packet report and use **Print / PDF**, **Copy Markdown** and **Download .md / .json**.

---

## Architecture

- **`src/core/`** — framework-free, deterministic engine: graph utilities, routing algorithms (link-state/DV/RIP/OSPF/BGP), IPv4/CIDR, IPv6, fragmentation, ICMP/traceroute, virtual-circuit model, the packet simulator, JSON (de)serialization, and report builders. It has no React dependency and is unit-tested directly.
- **`src/components/`** — the reusable UI (`ui.tsx`) and the interactive SVG canvas (`TopologyCanvas.tsx`) with pan / zoom / drag.
- **`src/modules/`** — one screen per teaching module; each renders what `core` computed, nothing more.
- **`src/state/store.tsx`** — React context + reducer; current topology and packet settings persist to `localStorage` under `netscope.state.v1`.

## Verification status

- `npx tsc -b` — clean.
- `npm run test` — **129 tests, all passing.**
- `npm run lint` — 0 errors (4 pre-existing React-Compiler advisory warnings in `TopologyCanvas.tsx` about reading a ref during render; harmless, not blocking).
- `npm run build` — succeeds; static bundle in `dist/`.
- The flagship packet journey, both binding worked examples, all ten modules and every report generator were checked in a live browser.
