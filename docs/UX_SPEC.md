# UX_SPEC.md — Focus Mode design contract

> **Owner:** A3 (UI/UX Designer) · **Task:** T-007 (P0, W0 gate) · **Status:** REVIEW → A4 accepts in W1
> **Consumers:** A4 (`client/**` except `client/src/styles/**`), A7 (Focus Agent window/tray, T-059), A9 (axe pass T-084).
> **Source of truth:** `REQUIREMENTS.md` (FR-009/021/022, NFR-006/007/008, §8), `TECHNICAL_DESIGN.md` §3 + §7.5–7.6, `docs/DECISIONS.md`. Blueprint wins over this spec; A2 records any DEC if they disagree.
> **Rules for A4:** no hex outside §1; no user-facing error string outside §6; no page without all four NFR-007 states. Ask A3 instead of improvising a token.
> **Stance:** calm and boring. Only two things are loud — **agent status** and **focus state**, both always visible and cancellable. One primary action per screen, no gradients, no decorative animation, no icon-only status, no dark patterns. The countdown is the only moving number.

---

## 1. Design tokens

### 1.1 PDF §14 palette — sanctioned role per colour

Raw colours are inputs, not automatically safe text colours; §2 proves each role.

| Token | Hex | Sanctioned use | Never use for |
|---|---|---|---|
| `base` | `#1E1B4B` | `/focus` + sidebar backgrounds, hero, inverse toast | text on light, text on itself |
| `surface` | `#F8FAFC` | app background (authenticated pages) | text |
| `primary` | `#4F46E5` | primary button fill, links, active nav, focus ring | text on `base` |
| `focus` (teal) | `#0D9488` | **graphics only**: ring accents, icon strokes, ≥24 px marks | text, small labels, fill behind normal white text |
| `amber` | `#D97706` | warning icons, warning text on `base`, chip with dark label | text on light, fill behind normal white text |
| `danger` | `#DC2626` | destructive button fill, error icons | error text on subtle/dark surfaces |
| `ink` | `#0F172A` | body/table text | text on `base` (1.12:1) |
| `muted` | `#64748B` | secondary text, helper, placeholder — **light surfaces only** | text on `base` (3.36:1) |

### 1.2 Derived tokens (all contrast-verified in §2)

| Token | Hex | Role |
|---|---|---|
| `card` / `table-header` / `skeleton` / `toast` | `#FFFFFF` / `#F1F5F9` / `#E2E8F0` / `#0F172A` | cards+dialogs / table head / static loading blocks / inverse toast (white text) |
| `primary-hover` / `primary-active` / `primary-subtle` | `#4338CA` / `#3730A3` / `#EEF2FF` | primary hover / pressed / selected-chip fill |
| `focus-strong` / `focus-strong-hover` | `#0F766E` / `#115E59` | teal **text on light** and teal **fill** behind white text (hover variant) |
| `focus-subtle` / `focus-on-base` | `#F0FDFA` / `#2DD4BF` | focus callout fill / teal text+marks on `base`, ring progress |
| `danger-text` / `danger-hover` / `danger-subtle` | `#B91C1C` / `#B91C1C` / `#FEF2F2` | all error text / destructive hover / error banner |
| `success-text` / `success-fill` / `success-subtle` | `#166534` / `#15803D` / `#F0FDF4` | success text / success button / success banner |
| `amber-text` / `amber-strong` / `amber-subtle` | `#92400E` / `#B45309` / `#FFFBEB` | warning text / warning button / warning banner |
| `text-on-base-muted` / `link-on-base` / `danger-on-base` / `nav-active-bg` | `#C7D2FE` / `#A5B4FC` / `#F87171` / `#312E81` | secondary on `base` / links on `base` / danger on `base` / active sidebar fill |
| `border` / `border-strong` | `#E2E8F0` / `#64748B` | decorative dividers **only** / control boundaries (inputs, selects) |
| `disabled-fill` / `disabled-text` | `#E2E8F0` / `#475569` | disabled control fill / label |
| `ring` / `ring-on-base` / `ring-track` | `#4F46E5` / `#A5B4FC` / `#6366F1` | focus ring on light / on `base` / countdown-ring track on `base` |
| `badge-*-bg` | success `#DCFCE7` · neutral `#E2E8F0` · focus `#CCFBF1` · amber `#FEF3C7` · danger `#FEE2E2` · info `#E0E7FF` | badge fills; labels: `#166534` · `#475569` · `#115E59` · `#92400E` · `#991B1B` · `#3730A3` |

### 1.3 CSS custom properties — `client/src/styles/tokens.css` (A3 owns; A4 imports)

`@theme` emits its `--color-*` variables on `:root`, so inline SVG can use them directly.

```css
/* Focus Mode layout + motion tokens. Colour tokens live in theme.css (@theme). */
:root {
  --fm-duration-fast: 120ms; --fm-duration-base: 180ms; --fm-duration-slow: 240ms;
  --fm-ease-calm: cubic-bezier(0.2, 0, 0, 1);
  --fm-ring-width: 2px; --fm-ring-offset: 2px;
  --fm-sidebar-w: 248px; --fm-content-max: 1200px; --fm-page-pad-x: 16px;
  --fm-focus-indicator-h: 44px;
  /* countdown ring — SVG reads these */
  --fm-ring-size-lg: 320px; --fm-ring-size-md: 280px; --fm-ring-size-sm: 220px;
  --fm-ring-stroke-lg: 12px; --fm-ring-stroke-sm: 10px;
  --fm-ring-track-color: var(--color-ring-track);
  --fm-ring-progress-color: var(--color-focus-on-base);
  /* z-index scale — never invent local values */
  --fm-z-sticky: 10; --fm-z-nav: 20; --fm-z-drawer: 30; --fm-z-modal: 40; --fm-z-toast: 50;
}
@media (min-width: 768px)  { :root { --fm-page-pad-x: 24px; } }
@media (min-width: 1024px) { :root { --fm-page-pad-x: 32px; } }
@media (prefers-reduced-motion: reduce) {
  :root { --fm-duration-fast: 0.01ms; --fm-duration-base: 0.01ms; --fm-duration-slow: 0.01ms; }
}
```

### 1.4 Tailwind 4 `@theme` — `client/src/styles/theme.css`

```css
@import "tailwindcss";
@import "./tokens.css";
@theme {
  /* PDF §14 raw palette */
  --color-base: #1E1B4B;      --color-surface: #F8FAFC;
  --color-primary: #4F46E5;   --color-focus: #0D9488;
  --color-amber: #D97706;     --color-danger: #DC2626;
  --color-ink: #0F172A;       --color-muted: #64748B;
  /* surfaces / structure */
  --color-card: #FFFFFF;      --color-table-header: #F1F5F9;
  --color-skeleton: #E2E8F0;  --color-toast: #0F172A;
  --color-border: #E2E8F0;    --color-border-strong: #64748B;
  /* primary family */
  --color-primary-hover: #4338CA;  --color-primary-active: #3730A3;
  --color-primary-subtle: #EEF2FF;
  /* focus (teal) family — graphics on Base, text/fill on light */
  --color-focus-strong: #0F766E;       --color-focus-strong-hover: #115E59;
  --color-focus-subtle: #F0FDFA;       --color-focus-on-base: #2DD4BF;
  /* semantic text */
  --color-danger-text: #B91C1C;   --color-danger-hover: #B91C1C;
  --color-danger-subtle: #FEF2F2;
  --color-success-text: #166534;  --color-success-fill: #15803D;
  --color-success-subtle: #F0FDF4;
  --color-amber-text: #92400E;    --color-amber-strong: #B45309;
  --color-amber-subtle: #FFFBEB;
  /* on dark (Base) */
  --color-text-on-base-muted: #C7D2FE; --color-link-on-base: #A5B4FC;
  --color-danger-on-base: #F87171;     --color-nav-active-bg: #312E81;
  /* disabled + rings */
  --color-disabled-fill: #E2E8F0; --color-disabled-text: #475569;
  --color-ring: #4F46E5;          --color-ring-on-base: #A5B4FC;
  --color-ring-track: #6366F1;
  /* badges: fill (label colour in comment) */
  --color-badge-success-bg: #DCFCE7; /* label success-text #166534 */
  --color-badge-neutral-bg: #E2E8F0; /* label #475569 */
  --color-badge-focus-bg: #CCFBF1;   /* label #115E59 */
  --color-badge-amber-bg: #FEF3C7;   /* label amber-text #92400E */
  --color-badge-danger-bg: #FEE2E2;  /* label #991B1B */
  --color-badge-info-bg: #E0E7FF;    /* label #3730A3 */
  /* type + shape + elevation + easing */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --radius-control: 0.5rem; --radius-card: 0.75rem; --radius-pill: 9999px;
  --shadow-card: 0 1px 2px rgb(15 23 42 / 0.06), 0 4px 16px rgb(15 23 42 / 0.06);
  --shadow-modal: 0 12px 40px rgb(15 23 42 / 0.18);
  --ease-calm: cubic-bezier(0.2, 0, 0, 1);
}
```

**Recipes (shadcn-style, no new libraries):** primary button `h-10 px-4 text-sm font-medium bg-primary text-white hover:bg-primary-hover active:bg-primary-active`; destructive `bg-danger text-white hover:bg-danger-hover`; secondary `bg-card text-ink border border-border-strong hover:bg-primary-subtle`; card `bg-card border border-border rounded-[var(--radius-card)] shadow-[var(--shadow-card)]`; input `h-10 rounded-[var(--radius-control)] border border-border-strong bg-card text-ink placeholder:text-muted`; focus `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface` (on `base`: `ring-ring-on-base ring-offset-base`). Input borders use `border-strong` deliberately — `border` is 1.18:1 and fails the 3:1 control-boundary rule.

### 1.5 Type, spacing, state tokens

| Token | Value | Use |
|---|---|---|
| `display` / `h1` / `h2` | 48/1.05 700 `tabular-nums` · 28/1.2 600 · 20/1.3 600 | countdown + hero metrics / page title / card title |
| `body` / `small` / `code` | 15/1.55 400 · 13/1.45 400 · mono 15/1.2 `tabular-nums` | default / helper + captions / IDs + code input |
| `pairing-display` (agent) | mono 40/1.1, 600, `letter-spacing:.18em`, `tabular-nums` | 6-digit code in the Focus Agent |
| spacing / radii / controls | 4 px base (8/12/16/24/32) · control 8, card 12, pill · 40 px (44 px touch) | everything |

**Colour = CSS variables only.** No component may hard-code a hex; `grep -n '#[0-9A-Fa-f]\{6\}' client/src --include='*.tsx'` must return nothing (T-084 review step).

---

## 2. Contrast audit — computed, not estimated

### 2.1 Method

WCAG 2.x: `L = 0.2126·R + 0.7152·G + 0.0722·B`, channels linearised as `c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`; `ratio = (L1+0.05)/(L2+0.05)`, L1 ≥ L2. All numbers below come from this throwaway script (A3, T-007; not shipped in `client/` — re-run when a token changes); output pasted verbatim:

```
$ node /tmp/ux/wcag-contrast.mjs
```

### A. Sanctioned text pairs — required 4.5:1 (43 pairs)

| foreground | background | token pair | ratio | ≥4.5 | ≥3.0 | where used |
|---|---|---|---|---|---|---|
| #0F172A | #F8FAFC | ink/surface | 17.06 | PASS | PASS | body text |
| #0F172A | #FFFFFF | ink/card | 17.85 | PASS | PASS | card body text |
| #1E1B4B | #F8FAFC | base/surface | 15.28 | PASS | PASS | page headings |
| #64748B | #F8FAFC | muted/surface | 4.55 | PASS | PASS | secondary, helper, placeholder |
| #64748B | #FFFFFF | muted/card | 4.76 | PASS | PASS | secondary on cards |
| #4F46E5 | #F8FAFC | primary/surface | 6.01 | PASS | PASS | links, active nav label |
| #4F46E5 | #FFFFFF | primary/card | 6.29 | PASS | PASS | links on cards |
| #4F46E5 | #EEF2FF | primary/primary-subtle | 5.62 | PASS | PASS | selected chip text |
| #0F766E | #F8FAFC | focus-strong/surface | 5.23 | PASS | PASS | teal text (labels, "Focusing") |
| #0F766E | #F0FDFA | focus-strong/focus-subtle | 5.25 | PASS | PASS | focus callout text |
| #92400E | #F8FAFC | amber-text/surface | 6.78 | PASS | PASS | warning text |
| #92400E | #FFFBEB | amber-text/amber-subtle | 6.84 | PASS | PASS | warning banner text |
| #B91C1C | #F8FAFC | danger-text/surface | 6.18 | PASS | PASS | inline error text |
| #B91C1C | #FEF2F2 | danger-text/danger-subtle | 5.91 | PASS | PASS | error banner text |
| #166534 | #F8FAFC | success-text/surface | 6.81 | PASS | PASS | success text |
| #166534 | #F0FDF4 | success-text/success-subtle | 6.81 | PASS | PASS | success banner text |
| #0F172A | #F1F5F9 | ink/table-header | 16.30 | PASS | PASS | table head text |
| #475569 | #F1F5F9 | slate-600/table-header | 6.92 | PASS | PASS | table head secondary |
| #FFFFFF | #1E1B4B | white/base | 15.99 | PASS | PASS | headlines, countdown digits |
| #C7D2FE | #1E1B4B | on-base-muted/base | 10.72 | PASS | PASS | secondary text on Base |
| #A5B4FC | #1E1B4B | link-on-base/base | 8.02 | PASS | PASS | links on Base |
| #2DD4BF | #1E1B4B | focus-on-base/base | 8.59 | PASS | PASS | teal text/marks on Base |
| #F87171 | #1E1B4B | danger-on-base/base | 5.78 | PASS | PASS | danger text on Base |
| #D97706 | #1E1B4B | amber/base | 5.02 | PASS | PASS | warning text/icon on Base |
| #FFFFFF | #312E81 | white/nav-active | 11.42 | PASS | PASS | active sidebar item |
| #C7D2FE | #312E81 | on-base-muted/nav-active | 7.66 | PASS | PASS | idle sidebar item |
| #FFFFFF | #0F172A | white/toast | 17.85 | PASS | PASS | inverse toast text |
| #FFFFFF | #4F46E5 | white/primary | 6.29 | PASS | PASS | primary button, Confirm |
| #FFFFFF | #4338CA | white/primary-hover | 7.90 | PASS | PASS | primary hover |
| #FFFFFF | #3730A3 | white/primary-active | 9.93 | PASS | PASS | primary pressed |
| #FFFFFF | #DC2626 | white/danger | 4.83 | PASS | PASS | destructive button |
| #FFFFFF | #B91C1C | white/danger-hover | 6.47 | PASS | PASS | destructive hover |
| #FFFFFF | #0F766E | white/focus-strong | 5.47 | PASS | PASS | teal button (agent End focus) |
| #FFFFFF | #115E59 | white/focus-strong-hover | 7.58 | PASS | PASS | teal button hover |
| #FFFFFF | #B45309 | white/amber-strong | 5.02 | PASS | PASS | warning button |
| #0F172A | #D97706 | ink/amber | 5.60 | PASS | PASS | amber chip, dark label |
| #FFFFFF | #15803D | white/success-fill | 5.02 | PASS | PASS | success button |
| #166534 | #DCFCE7 | success-text/badge-success | 6.49 | PASS | PASS | badge: Connected, completed |
| #475569 | #E2E8F0 | slate-600/badge-neutral | 6.15 | PASS | PASS | badge: Disconnected, idle |
| #115E59 | #CCFBF1 | teal-800/badge-focus | 6.73 | PASS | PASS | badge: Focusing |
| #92400E | #FEF3C7 | amber-text/badge-amber | 6.37 | PASS | PASS | badge: warning, pairing pending |
| #991B1B | #FEE2E2 | red-800/badge-danger | 6.80 | PASS | PASS | badge: error count |
| #3730A3 | #E0E7FF | indigo-800/badge-info | 8.06 | PASS | PASS | badge: info, scheduled |

### B. Sanctioned non-text UI — required 3:1 (10 pairs; last row exempt)

| foreground | background | token pair | ratio | ≥4.5 | ≥3.0 | where used |
|---|---|---|---|---|---|---|
| #64748B | #F8FAFC | border-strong/surface | 4.55 | PASS | PASS | input boundary |
| #64748B | #FFFFFF | border-strong/card | 4.76 | PASS | PASS | input boundary on cards |
| #4F46E5 | #F8FAFC | ring/surface | 6.01 | PASS | PASS | focus ring on light |
| #4F46E5 | #FFFFFF | ring/card | 6.29 | PASS | PASS | focus ring on cards |
| #4F46E5 | #EEF2FF | ring/primary-subtle | 5.62 | PASS | PASS | focus ring on selected row |
| #A5B4FC | #1E1B4B | ring-on-base/base | 8.02 | PASS | PASS | focus ring on Base |
| #6366F1 | #1E1B4B | ring-track/base | 3.58 | FAIL | PASS | countdown ring track |
| #2DD4BF | #1E1B4B | focus-on-base/base | 8.59 | PASS | PASS | countdown ring progress |
| #475569 | #E2E8F0 | disabled-text/disabled-fill | 6.15 | PASS | PASS | disabled label (also >4.5) |
| #4F46E5 | #E2E8F0 | ring/disabled-fill | 5.10 | PASS | PASS | ring next to disabled control |
| #E2E8F0 | #F8FAFC | border/surface | 1.18 | FAIL | FAIL | divider only — EXEMPT, never sole indicator |

### C. Forbidden pairings — measured, then banned (15 pairs, must all fail 4.5)

| foreground | background | token pair | ratio | ≥4.5 | ≥3.0 | where used |
|---|---|---|---|---|---|---|
| #0F172A | #1E1B4B | ink/base | 1.12 | FAIL | FAIL | dark-on-dark; use white |
| #64748B | #1E1B4B | muted/base | 3.36 | FAIL | PASS | use on-base-muted #C7D2FE |
| #4F46E5 | #1E1B4B | primary/base | 2.54 | FAIL | FAIL | use link-on-base #A5B4FC |
| #DC2626 | #1E1B4B | danger/base | 3.31 | FAIL | PASS | use danger-on-base #F87171 |
| #0D9488 | #1E1B4B | focus/base | 4.27 | FAIL | PASS | use focus-on-base #2DD4BF |
| #0D9488 | #F8FAFC | focus/surface | 3.58 | FAIL | PASS | use focus-strong #0F766E |
| #0D9488 | #FFFFFF | focus/card | 3.74 | FAIL | PASS | use focus-strong #0F766E |
| #D97706 | #F8FAFC | amber/surface | 3.04 | FAIL | PASS | use amber-text #92400E |
| #D97706 | #FFFBEB | amber/amber-subtle | 3.07 | FAIL | PASS | use amber-text #92400E |
| #FFFFFF | #0D9488 | white/focus | 3.74 | FAIL | PASS | fill uses focus-strong #0F766E |
| #FFFFFF | #D97706 | white/amber | 3.19 | FAIL | PASS | fill uses amber-strong #B45309 |
| #DC2626 | #FEF2F2 | danger/danger-subtle | 4.41 | FAIL | PASS | use danger-text #B91C1C |
| #64748B | #E2E8F0 | muted/disabled-fill | 3.86 | FAIL | PASS | use disabled-text #475569 |
| #94A3B8 | #FFFFFF | slate-400/card | 2.56 | FAIL | FAIL | never text or border |
| #FFFFFF | #16A34A | white/green-600 | 3.30 | FAIL | PASS | fill uses success-fill #15803D |

### D. Adjusted token proposals (original → replacement, recomputed)

| purpose | original | ratio | replacement | ratio |
|---|---|---|---|---|
| muted on Base | #64748B | 3.36 | on-base-muted `#C7D2FE` | 10.72 |
| focus text on light | #0D9488 | 3.58 | focus-strong `#0F766E` | 5.23 |
| white on teal fill | #0D9488 | 3.74 | focus-strong `#0F766E` | 5.47 |
| amber text on surface | #D97706 | 3.04 | amber-text `#92400E` | 6.78 |
| amber text on amber-subtle | #D97706 | 3.07 | amber-text `#92400E` | 6.84 |
| white on amber fill | #D97706 | 3.19 | amber-strong `#B45309` | 5.02 |
| danger text on danger-subtle | #DC2626 | 4.41 | danger-text `#B91C1C` | 5.91 |
| muted on table header | #64748B | 4.34 | slate-600 `#475569` | 6.92 |
| disabled label | #64748B | 3.86 | disabled-text `#475569` | 6.15 |
| primary text on Base | #4F46E5 | 2.54 | link-on-base `#A5B4FC` | 8.02 |
| danger text on Base | #DC2626 | 3.31 | danger-on-base `#F87171` | 5.78 |
| teal text on Base | #0D9488 | 4.27 | focus-on-base `#2DD4BF` | 8.59 |
| control border on surface | #E2E8F0 | 1.18 | border-strong `#64748B` | 4.55 |
| success fill with white | #16A34A | 3.30 | success-fill `#15803D` | 5.02 |

### E. Summary

| metric | value |
|---|---|
| pairs measured (A–D) | 83 |
| A: text pairs passing 4.5:1 | 43 / 43 |
| B: non-text pairs passing 3:1 | 10 / 10 (exempt divider excluded) |
| C: banned pairings failing 4.5:1 as intended | 15 / 15 |
| D: adjusted tokens passing 4.5:1 | 14 / 14 |

### 2.2 Binding rules from the audit

1. **43/43 sanctioned text pairs pass 4.5:1; 10/10 sanctioned non-text pairs pass 3:1; 14 adjusted tokens replace the 14 failing raw/naive pairings.** Use the replacement token; never tune a hex locally.
2. `muted` on `surface` is **4.55:1** — tightest sanctioned pair (0.05 margin). Do not change either hex; do not use `muted` on `table-header` (4.34:1 → `#475569`, 6.92:1).
3. `focus` teal `#0D9488` is **graphics-only** (3.58:1). Teal text → `focus-strong #0F766E`; teal fill behind white text → `focus-strong` (5.47:1). Same pattern for `amber` (text → `amber-text`; fill → `amber-strong`; ink-on-amber chip 5.60:1 allowed). `danger #DC2626` is a fill (white 4.83:1) and icon colour; **all error text** is `danger-text #B91C1C` (6.18:1 surface, 5.91:1 subtle).
4. On `base` never use `ink`, `muted`, `primary`, raw `danger`, raw `focus` as text — use `white` / `text-on-base-muted` / `link-on-base` / `danger-on-base` / `focus-on-base`.
5. Disabled controls use `disabled-fill` + `disabled-text` (6.15:1) even though WCAG exempts disabled text — NFR-008 says 4.5:1. **Status is never colour-only**: every badge/state is icon + text (§10). `border #E2E8F0` is decorative; anything perceived as a control uses `border-strong #64748B` (4.55:1).

---

## 3. App shell, status badge, focus indicator (FR-021, FR-009)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ FocusIndicator (sticky, every authenticated route + 403/404, z-sticky)        │
│  ◆ Focusing — 42:10 left                              [ End Focus ]           │
├──────────────────┬────────────────────────────────────────────────────────────┤
│ ▟ Focus Mode     │  PageHeader: <h1>Dashboard</h1>          AgentStatusBadge   │
│                  │                              [ ✓ Connected ]  (icon+text)  │
│ ◆ Dashboard      │  ┌──────────────────────────────────────────────────────┐  │
│   Focus          │  │   page content (§4)                                  │  │
│   Devices        │  └──────────────────────────────────────────────────────┘  │
│   Allow-list     │                                                            │
│   Schedules      │                                                            │
│   Insights       │                                                            │
│   Settings       │                                                            │
│ ─────────────    │                                                            │
│   Admin  (ADMIN) │                                                            │
│ [ ✓ Connected ]  │                                                            │
│ 🔔 2   [ Avatar ]│                                                            │
└──────────────────┴────────────────────────────────────────────────────────────┘
```

- Sidebar: `base` fill, 248 px @≥1024, slide-over `Sheet` below that. USER sees 7 items; ADMIN sees the same + `Admin` under a divider — role-aware render **and** route guard (API returns 403 regardless). Active item `bg-nav-active-bg text-white` + 3 px `focus-on-base` left bar.
- Header: title left; `AgentStatusBadge` right; notifications bell with count; avatar menu (Profile / Sign out). Dialogs trap focus, `aria-modal="true"`, Escape = cancel. Toasts bottom-right (`z-toast`); errors `role="alert"`, never auto-dismissed.
- Main: `max-w-[var(--fm-content-max)]`, `page-pad-x`, bottom padding while the focus indicator is shown.

**`AgentStatusBadge`** — icon + text always (never icon-only, never colour-only):

| AgentLink state | Icon (lucide) | Text | Fill / label | Extra |
|---|---|---|---|---|
| `PAIRED` (connected) | `CheckCircle2` | `Connected` | `badge-success-bg` / `#166534` | tooltip `detail`: "Your Focus Agent is connected." |
| `DISCONNECTED` | `CircleSlash2` | `Disconnected` | `badge-neutral-bg` / `#475569` | click → help card §6.3; tooltip "No Focus Agent is reachable on this computer." |
| `FOCUSING` | `Target` | `Focusing` | `badge-focus-bg` / `#115E59` | tooltip "Your Focus Agent is running a focus session." |
| `IDLE` (reachable, unpaired) | `CircleSlash2` | `Not paired` | `badge-neutral-bg` / `#475569` | tooltip "Your Focus Agent is running but not paired to this account." |
| `CONNECTING` (first seconds) | `Loader2` (static) | `Connecting…` | neutral | disappears when resolved |

`aria-label="Focus Agent status: Connected"`, `aria-live="polite"` on the label. User-facing copy always says **Focus Agent**, never bare "agent" (AGENTS.md §0). Tooltip text is the provider's user-safe `detail` sentence, **not** a templated device name — before attestation the dashboard does not know which paired device the loopback agent maps to, so inventing a device name would be dishonest (ratified in the W1/W2 review, §12.4 D2).

**`FocusIndicator`** — persistent on every authenticated route **and** `/403`; not on `/`, `/login`, `/signup`, and not on the standalone `/404` (the catch-all must also serve signed-out visitors, so it is deliberately outside the AppShell — ratified §12.4 D4). Sticky top bar at every width (bottom-fixed on mobile was dropped in W2 so the bar can never cover the End Focus dialog footer; ratified D6). Shows teal mark + "Focusing" + remaining minutes (from agent `endsAt`) + `End Focus` (always enabled). No animation, no live region (the badge already announces). If the link drops mid-session the bar must keep a warning state rather than vanishing — see fix F-02 (§12.5).

---

## 4. Page wireframes (13 routes)

All inside AppShell §3 unless marked *(public)*. Widths assume 1440. Exact state strings are in §6.1; each page's four NFR-007 states are listed under it.
### 4.1 `/` Landing *(public)*
```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▟ Focus Mode        How it works   Download   [Log in]   [Get started]   │
├──────────────────────────────────────────────────────────────────────────┤
│  Focus on one thing.                    │ ┌ 1  Download the Focus Agent ┐ │
│  Your browser stays open.               │ │    macOS · Windows · Linux  │ │
│  Everything else steps aside —          │ ├ 2  Open it — it shows a    │ │
│  visibly, reversibly, only on           │ │    6-digit code             │ │
│  your own computer.                     │ ├ 3  Enter the code on       │ │
│                                         │ │    /devices, then focus     │ │
│  [ Get started — free ]                 │ └─────────────────────────────┘ │
│  [ I already have a Focus Agent ]       │                                 │
├──────────────────────────────────────────────────────────────────────────┤
│ Promise strip: Consent before every start · End any time (dashboard,    │
│ tray, quit) · Nothing deleted or quit · No window titles/URLs leave     │
│ your machine.                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```
**loading** install pills are skeletons · **empty** "Installer links are being published — check back soon." · **error** "We couldn't load downloads." + Retry · **success** 3 OS buttons with version.
### 4.2 `/login` and `/signup` *(public)*
```
/login (400 px card, surface bg)          /signup
┌──────────────────────────────┐          ┌──────────────────────────────┐
│        ▟ Focus Mode          │          │        ▟ Focus Mode          │
│  Welcome back                │          │  Create your account         │
│  Email     [ ............. ] │          │  Name     [ ............. ]  │
│  Password  [ ............. ] │          │  Email    [ ............. ]  │
│  [       Log in        ]     │          │  Password [ ............. ]  │
│  New here? Sign up →         │          │  8–72 chars, ≥1 letter + digit│
└──────────────────────────────┘          │  [   Create account   ]      │
                                          └──────────────────────────────┘
```
**loading** button "Logging in…"/"Creating account…" + inputs disabled · **empty** n/a (static form) · **error** inline field errors from `details[]`; banner for 401/429/403 `ACCOUNT_DISABLED`; email taken 409 → "An account with that email already exists. Try logging in." · **success** redirect `/dashboard`, toast "Signed in"; signup → `/dashboard?welcome=1` with the install → pair → focus checklist (US-1).
### 4.3 `/dashboard`
```
┌ Dashboard · Good evening, Kabir                        [ ✓ Connected ] ┐
│ ┌ Start a focus session ───────────────────┐ ┌ Today ───────────────┐ │
│ │ Duration   [25] [50] [60] [Custom…]      │ │ 1 h 40 m focused     │ │
│ │            1–480 min                     │ │ Streak: 4 days       │ │
│ │ Allow-listed: Chrome · VS Code           │ │ Next: Coding 09:00   │ │
│ │ [ Start Focus ]  ← disabled + reason if  │ │ (tomorrow)           │ │
│ │   no agent / unsupported                 │ └──────────────────────┘ │
│ └──────────────────────────────────────────┘                          │
│ ┌ Recent sessions ───────────────────────────────────────────────────┐ │
│ │ Today 10:00–11:00 · 60 m · COMPLETED · Manual                      │ │
│ │ Yesterday 09:00–09:25 · 25 m · COMPLETED · Schedule                │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```
**loading** 3 skeleton cards, badge "Connecting…" · **empty** new user → checklist card "Set up Focus Mode — install → pair → start" + "No focus sessions yet. Your first session will show up here." · **error** per-widget "We couldn't load your dashboard." + Retry (page survives); no-device is **not** an error → §6.4 card · **success** toasts "Focus started" (→ `/focus`), "Device unpaired".
### 4.4 `/focus`
```
┌  Base background, calm — one action                                          ┐
│  ◆ FOCUSING · 60 min planned · started 10:00 · device: Kabir's MacBook       │
│                                                                              │
│                        ╭──────────────────╮                                  │
│                       │     42:10        │  ← SVG ring 320/280/220 px        │
│                       │    remaining     │    role="img" + aria-label        │
│                        ╰──────────────────╯                                  │
│                                                                              │
│  Stays open    Chrome · Focus Agent · system essentials · VS Code            │
│  Stepped aside 6 apps — minimised, not closed · re-aside: on                 │
│  [ End Focus ]  ← large, always enabled                                      │
│  You can also end from the Focus Agent tray menu, or by quitting it.         │
└──────────────────────────────────────────────────────────────────────────────┘
```
**loading** "Checking your session with the Focus Agent…" + static ring skeleton (hard reload only, < 2 s) · **empty** "No focus session is running." + [Start a session] [Back to dashboard] · **error** link lost → amber banner "Lost contact with your Focus Agent. Your session keeps running — the agent ends it on time. Reconnect to End from here." + Reconnect; `UNSUPPORTED` never reaches this page (blocked on dashboard with reason) · **success** end → "Focus ended — your windows are back." + session summary, dismiss → `/dashboard`.
### 4.5 `/devices` + pair/unpair dialogs
```
┌ Devices                                              [ + Pair a device ] ┐
│ ┌ Kabir's MacBook · macOS 15.7 · arm64                    [ ✓ Connected ] │
│ │ Paired 2 Nov 2026 · last seen 12 s ago · Focus Agent v1.0.0            │
│ │ Capabilities: window control full · allow-list v3                      │
│ │ [ Unpair ]        [ Download Focus Agent ]                             │
│ └────────────────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────────────┘

Pair dialog (440 px, modal)              Unpair confirm (400 px)
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│ Pair a device              [ × ] │     │ Unpair this device?        [ × ] │
│ Open your Focus Agent and type   │     │ Kabir's MacBook will stop being  │
│ the 6-digit code it shows.       │     │ able to start focus until you    │
│  [ 4 8 2 9 1 6 ]  mono, autofocus │     │ pair it again.                   │
│ The code is shown only in the    │     │ [ Cancel ]        [ Unpair ]     │
│ Focus Agent — never on this page.│     └──────────────────────────────────┘
│ error slot (inline)              │
│ [ Cancel ]        [ Pair device ]│  ← disabled until 6 digits
└──────────────────────────────────┘
```
**loading** device-card skeletons; submit → "Pairing…" + 5 s poll · **empty** §6.4 card (no device) · **error** list fetch → retry card; `INVALID_PAIRING_CODE`/`PAIRING_EXPIRED` inline under the field; agent unreachable after code submit → "Code accepted, but we couldn't reach your Focus Agent. Keep it open and try again." · **success** dialog closes, "Connecting…" → "Connected", toast "Agent connected".
### 4.6 `/allowlist`
```
┌ Allow-list                                        [ Preset: Coding ▾ ]   ┐
│ Protected — always stays open (locked)                                   │
│  🔒 All web browsers — Chrome, Edge, Firefox, Safari, Brave, …          │
│  🔒 Focus Agent                                                          │
│  🔒 System essentials — Task Manager / Activity Monitor, File Explorer / │
│     Finder, Dock / taskbar, System Settings                              │
│  (lock icon + "Protected" text badge; NO remove or edit control)         │
│                                                                          │
│ Your apps — these stay open; everything else steps aside                 │
│  [ VS Code ] [ Slack ] [ Spotify ]                        [ + Add app ]  │
│  (picker: running apps via agent `listApps` + manual add; no titles)     │
│                                                                          │
│ We move windows aside during focus — we never close or quit an app.     │
└──────────────────────────────────────────────────────────────────────────┘
```
**loading** locked-row + chip skeletons · **empty** "Only protected apps are allow-listed right now. Add the apps you need for a focus session." · **error** 400 `PROTECTED_ENTRY` → inline "That app is protected and can't be changed. It stays open during focus."; 400 `VALIDATION_ERROR` → field error on manual add · **success** toast "Allow-list saved" (optimistic, revert on error).
### 4.7 `/schedules`
```
┌ Schedules · times shown in Asia/Kolkata                  [ + New schedule ] ┐
│ ┌ Coding block · Mon–Fri 09:00 · 60 min              [ ● Enabled ]  [ ⋯ ] │
│ │ Next run: tomorrow 09:00 IST · needs a connected Focus Agent            │
│ └─────────────────────────────────────────────────────────────────────────┘
│ ┌ Pomodoro hour · Every day 19:00 · 50 min           [ ○ Disabled ] [ ⋯ ] │
│ └─────────────────────────────────────────────────────────────────────────┘
│ Info: a scheduled session starts only while your Focus Agent is connected │
│ and only after a 10-second heads-up you can cancel. Missed runs appear in │
│ notifications (bell), not here.                                          │
└───────────────────────────────────────────────────────────────────────────┘
```
**loading** 2 skeleton rows · **empty** "No schedules yet. Add one for your next deep-work block." · **error** fetch retry card; inline validation (days non-empty, `HH:mm`, 1–480); warning "No Focus Agent connected — this schedule can't start until one is." · **success** toast "Schedule saved" / "Schedule disabled".
### 4.8 `/insights`
```
┌ Insights    [ 7 days ] [ 30 days ] [ 90 days ]                          ┐
│ ┌ Focus time ─┐ ┌ Completion ─┐ ┌ Current streak ┐ ┌ Best hours ──────┐ │
│ │   6 h 20 m  │ │     86 %    │ │    4 days      │ │ 09:00–11:00      │ │
│ └─────────────┘ └─────────────┘ └────────────────┘ └──────────────────┘ │
│ ┌ Daily focus minutes (Recharts bars, fixed 220 px) ────────────────────┐ │
│ │  ▁ ▃ ▅ ▂ ▇ ▃ ▁    y: minutes    x: last 7 local days                  │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ Recent sessions (date · duration · status · source) — paginated table     │
└──────────────────────────────────────────────────────────────────────────┘
```
**loading** metric + chart skeletons, no layout shift · **empty** "No focus data for this range yet. Finish a session to see your progress." (metrics "—", chart hidden) · **error** retry card in chart card; keep last known metrics · **success** range switch with `aria-busy="true"`. Copy says "focused time", never "planned"; numbers are `actualMinutes` (REQUIREMENTS §6).
### 4.9 `/settings`
```
┌ Settings   [ Profile ] [ Security ] [ Focus Agent ] [ Notifications ]    ┐
│ Profile:  Name [Kabir.....]  Email kabir@demo.com (read-only)             │
│           Timezone [Asia/Kolkata ▾]   Default duration [25] [50] [60]     │
│           [ Save changes ]                                                │
│ Security: Current password [ ] New [ ] Confirm [ ]  [ Update password ]   │
│ Focus Agent: Download macOS · Windows · Linux                             │
│           Start at login is controlled in the agent's tray (never here)   │
│           [ Unpair all devices ]  ← confirm; revokes agent tokens         │
│ Notifications: [x] Notify me about missed scheduled sessions              │
└───────────────────────────────────────────────────────────────────────────┘
```
**loading** form skeleton · **empty** n/a (profile always exists) · **error** inline validation; wrong current password → "Current password is incorrect."; 401 → login redirect · **success** toast "Settings saved" / "Password updated" / "All devices unpaired".
### 4.10 `/admin` (ADMIN only; USER → `/403`)
```
┌ Admin   [ Users ] [ Presets ] [ Agent links ] [ Stats ]                  ┐
│ Users  [ search name or email … ] [ role ▾ ] [ status ▾ ]                 │
│ Name        Email              Role   Status   Created    Actions         │
│ Kabir       kabir@demo.com     USER   Active   2 Nov      [ Deactivate ]  │
│ Meera       meera@demo.com     USER   Disabled 3 Nov      [ Activate ]    │
│ ‹ 1 2 3 … ›   total 128                                                  │
│ Presets: Coding (8 apps) [ Edit ]   Writing (5 apps) [ Edit ]   [ + New ] │
│ Agent links: macOS .dmg v1.0.0 [ Replace URL ]   Windows .exe …           │
│ Stats (aggregate only — no per-user session detail): 128 users · 1,204    │
│   sessions · 812 h focused                                               │
└──────────────────────────────────────────────────────────────────────────┘
```
**loading** table skeleton · **empty** "No users match your filters." / "No presets yet. Create the first one." · **error** retry card; mutation toasts for `FORBIDDEN`/`CONFLICT`/`INTERNAL` · **success** "User deactivated" / "Preset published" / "Download link updated". No UI affordance for per-user sessions (PDF §6 non-invasive).
### 4.11 `/403` and `/404`

`/403` renders inside the AppShell (badge + focus slot visible). `/404` is deliberately standalone (no AppShell, no FocusIndicator): the catch-all must also work for signed-out visitors, and bouncing a bad link to `/login` would be worse (ratified §12.4 D4 — this replaces the earlier "inside AppShell" wording).

```
/403 (inside AppShell)                    /404 (standalone, public)
┌────────────────────────────────────┐   ┌───────────────────────────────────┐
│  ⛔ 403 — You don't have access    │   │ 404 — We couldn't find that page   │
│  This page is for administrators.  │   │ The link may be wrong or the page  │
│  If that's wrong, ask an admin to  │   │ may have moved.                    │
│  update your role.                 │   │ [ Back to dashboard ] [ Go home ]  │
│  [ Back to dashboard ] [ Sign out ]│   └───────────────────────────────────┘
└────────────────────────────────────┘
```
**loading / empty / success** n/a (rendered synchronously by `RequireRole` / catch-all `*`) · **error** these *are* the error pages; also used for API `FORBIDDEN` navigations.

---

## 5. Consent modal — exact copy (FR-009, before **every** start)

Single **Confirm** button, no checkbox; no `enterFocus` before Confirm; Cancel/Escape/backdrop = cancel; scrollable body with sticky footer at 360 px. `ConsentModal.tsx` (T-056) — copy verbatim, `{placeholders}` from the selected duration/device/allow-list. The title below is **E2E-locked** (`e2e/focus.spec.ts` matches it) and was ratified in the W4/W5 review (§13.3 R2).

```
Title:   Start a {duration}-minute focus session?
Summary: This is exactly what will happen on {deviceName}. You can end it at
         any time.

DURATION ROW
  Duration: {duration} minutes — ends at {endsAt}.        [ Change ]

SECTION — These stay open
  • All web browsers (Chrome, Edge, Firefox, Safari and others)
  • The Focus Agent
  • System essentials: Task Manager (Windows) / Activity Monitor (macOS),
    File Explorer (Windows) / Finder (macOS), the Dock / taskbar,
    System Settings
  • Your allow-listed apps: {allowListLabels, or "none yet"}

SECTION — These will step aside
  Other open apps will be minimised or hidden so they're out of the way.
  They are not closed. Nothing is deleted or quit.
  Right now that's {count} app(s): {asideLabels — max 5, then "and N more"}.

SECTION — Keep new apps aside
  [toggle, default ON]
  On: apps that open or jump to the front during the session also step aside.
  Off: a newly opened app stays in front.

SECTION — You can end focus any time
  • End Focus on this dashboard
  • End Focus in the Focus Agent tray menu
  • Quit the Focus Agent — it restores your windows first

Fine print: Focus starts only after you confirm. This summary is shown before
every session. The Focus Agent never moves a window without your consent.

First run — AGENT-SIDE ONLY in v1 (ratified §13.3 R1):
  The dashboard cannot read the Focus Agent's stored consent (it is agent-local,
  §5.1/§7.1), so this modal makes no first-run claim. The native dialog in §5.1
  is the first-run gate; the agent window shows the stored status.

Footer:  [ Cancel ]                      [ Confirm — start focus ]
```

### 5.1 First-run native Focus Agent dialog (REC-004) — exact copy

Shown by the **agent**, never answerable by the web page (`CONSENT_REQUIRED` if missing); native message-box style, `[ Allow and continue ]` default.

```
Title:   Let Focus Mode move other apps aside?

Body:    Focus Mode will minimise or hide your other open apps while a focus
         session runs. They are not closed and nothing is deleted. Your web
         browsers, the Focus Agent, system essentials and your allow-listed
         apps stay open and usable.

         You can end focus at any time from the dashboard, from the tray
         menu, or by quitting the Focus Agent.

Stored:  This choice is stored on this computer only. You can revoke it in
         the tray menu → Focus Mode settings → Reset focus permission.

Buttons: [ Allow and continue ]  (default)          [ Not now ]
```

Agent window then shows `First-run permission: Granted on {date}  [ Reset ]`; after Reset: `First-run permission: Not granted — ask me again on the next start`. Never auto-grant; a denial is never stored as consent.

---

## 6. Copy deck

### 6.1 Per-screen loading / empty / error / success (NFR-007)

| Screen | Loading | Empty | Error | Success |
|---|---|---|---|---|
| `/` downloads | skeleton pills | "Installer links are being published — check back soon." | "We couldn't load downloads." + Retry | OS buttons + version |
| `/dashboard` | 3 skeleton cards | checklist + "No focus sessions yet. Your first session will show up here." | "We couldn't load your dashboard." + Retry | "Focus started" / "Device unpaired" |
| `/focus` | "Checking your session with the Focus Agent…" | "No focus session is running." + Start | "Lost contact with your Focus Agent. Your session keeps running…" + Reconnect | "Focus ended — your windows are back." |
| `/devices` | skeleton cards | §6.4 card | "We couldn't load your devices." + Retry; pairing errors inline | "Agent connected" |
| `/allowlist` | locked-row skeleton | "Only protected apps are allow-listed right now. Add the apps you need for a focus session." | "That app is protected and can't be changed." | "Allow-list saved" |
| `/schedules` | 2 skeleton rows | "No schedules yet. Add one for your next deep-work block." | "We couldn't load your schedules." + Retry | "Schedule saved" / "Schedule disabled" |
| `/insights` | metric + chart skeletons | "No focus data for this range yet. Finish a session to see your progress." | "We couldn't load your insights." + Retry | range refresh with `aria-busy` |
| `/settings` | form skeleton | n/a | inline field errors; "We couldn't save your settings." | "Settings saved" / "Password updated" |
| `/admin` | table skeleton | "No users match your filters." / "No presets yet." | "We couldn't load admin data." + Retry | "User deactivated" / "Preset published" |

Copy rules: sentence case; second person; no exclamation marks; no "Oops"; never show a stack trace or a code as the primary message (muted `small` line only where it helps support, e.g. `INTERNAL` → "… (Ref: {requestId})"). Buttons are verbs ("End Focus", "Pair device", "Save changes").

### 6.2 Error codes → user-facing message (REQUIREMENTS §8; server + local channel)

| Code | HTTP | Where shown | Message (verbatim) | Action |
|---|---|---|---|---|
| `VALIDATION_ERROR` | 400 | inline fields + summary | "Check the highlighted fields and try again." | map `details[]` to fields |
| `UNAUTHENTICATED` | 401 | toast + redirect | "Your session has expired. Please log in again." | clear token → `/login` |
| `UNAUTHENTICATED` (login form only) | 401 | banner on `/login` | "Email or password is incorrect." | keep the form, do not redirect (ratified §12.4 D1) |
| `FORBIDDEN` | 403 | toast or `/403` | "You don't have permission to do that." | stay / `403` page |
| `NOT_FOUND` | 404 | toast / inline | "We couldn't find that. It may have been removed." | refresh list |
| `CONFLICT` | 409 | toast / inline | "That action conflicts with something already in progress. Refresh and try again." | refresh |
| `RATE_LIMITED` | 429 | banner on form | "Too many attempts. Please wait a minute and try again." | disable 60 s |
| `INVALID_PAIRING_CODE` | 400 | inline under code | "That pairing code is wrong or has expired. Check the 6 digits in your Focus Agent and try again." | clear field |
| `PAIRING_EXPIRED` | 410 | inline under code | "This pairing code expired. Your Focus Agent is showing a new code — enter that one." | reopen agent |
| `PROTECTED_ENTRY` | 400 | inline banner | "This app is protected and must stay open during focus. It can't be removed." | revert row |
| `ALREADY_FOCUSING` | 409 | toast + indicator sync | "A focus session is already running on this device. End it before starting another." | go to `/focus` |
| `NO_DEVICE_CONNECTED` | 409 / local | card + toast | "No device connected — start your Focus Agent." | §6.4 card |
| `ACCOUNT_DISABLED` | 403 | login banner | "This account has been disabled. Contact an admin if you think this is a mistake." | no retry |
| `INTERNAL` | 500 | toast / `ErrorState` | "Something went wrong on our side. Please try again." | Retry |

Local-channel `focusRejected` codes reuse this shape; these six strings go in `AgentLink` error handling (ratified §12.4 D5 — `UNSUPPORTED` deliberately drops the `{reason}` slot: the agent-supplied text is a support detail, never the primary user message):

| Local code | Message |
|---|---|
| `ALREADY_FOCUSING` | same string as the API row above |
| `UNAUTHENTICATED` | "Your Focus Agent needs to be verified again. Pair it on Devices." |
| `NOT_PAIRED` | "Your Focus Agent isn't paired to this account yet. Pair it on Devices." |
| `CONSENT_REQUIRED` | "Confirm the first-run permission in the Focus Agent window, then try again." |
| `UNSUPPORTED` | "Your Focus Agent can't move windows on this system. Focus needs Windows, macOS, or Linux with X11." |
| `INVALID` | "The Focus Agent rejected that request. Try again — if it keeps happening, restart the Focus Agent." |

### 6.3 Local-network help card (S-4 / T-045) — "Can't reach your Focus Agent"

Shown as a dismissible full-width card at the top of `<main>` on every authenticated route after a failed local-link connect, and opened by clicking the `Disconnected` badge (W2 implementation; the original "badge popover" idea was replaced by this simpler always-visible placement — ratified §12.4 D3).

```
Title: Allow this site to reach your Focus Agent
Body:  Your browser may ask for permission to access devices on your local
       network. Choose Allow — the connection stays on this computer
       (ws://127.0.0.1:4545) and never leaves it.

By browser:
  Chrome / Edge  Settings → Privacy and security → Site settings →
                 Local network access → allow this site, then Reload.
  Firefox 147+   When the "Local network access" prompt appears, choose Allow.

  Safari         Safari can't open a local WebSocket from an HTTPS page.
                 Open this dashboard in Chrome, Edge or Firefox to connect
                 your Focus Agent.

Still not connecting?
  1. Start your Focus Agent and leave it running — its tray icon should be visible.
  2. Does the agent window show a pairing code or "Paired"?
  3. Reload this page. If it still fails, restart the Focus Agent.
Buttons: [ Reload page ]   [ Open download page ]      Dismiss: [ Dismiss ]
```

Safari variant: replace the by-browser block with one warning card — "**Your browser can't connect to the Focus Agent.** Safari can't open a local WebSocket from an HTTPS page. Use Chrome, Edge or Firefox for the dashboard." No silent failure, no retry loop.

### 6.4 "No device connected — start your Focus Agent" card (empty state)

```
◇  No device connected — start your Focus Agent
   1  Download the Focus Agent        [ macOS ] [ Windows ] [ Linux ]
   2  Open it — it shows a 6-digit pairing code
   3  Enter that code here            [ Pair a device ]
   Already installed? Open the Focus Agent and come back — this updates
   automatically when it connects.
```

Used on `/dashboard`, `/devices`, and as the disabled reason on `StartFocusCard`.

---

## 7. Focus Agent window + tray (T-059, FR-022, REC-008)

### 7.1 Agent window (464 × 620, resizable)

```
┌─ Focus Mode — Focus Agent ────────────────────────────── [–]  [ ] ─┐
│ State: ◇ Paired — ready              (IDLE / PAIRED / FOCUSING)     │
│ Cloud: ✓ Connected · dashboard link: ✓ Connected                   │
├─────────────────────────────────────────────────────────────────────┤
│ PAIRING CODE                                        (IDLE only)    │
│      4  8  2  9  1  6      ← mono 40px, letter-spacing .18em        │
│ Shown only in this window. It is never sent to the dashboard or    │
│ the cloud. Expires in 9:41.                  [ Copy code ]          │
├─────────────────────────────────────────────────────────────────────┤
│ 42:10 remaining · ends 11:00                      (FOCUSING only)   │
│ [ End focus ] ← teal fill, white label, always enabled; ends the   │
│                 session and restores windows                        │
├─────────────────────────────────────────────────────────────────────┤
│ Allow-list (read-only) · v3                                        │
│  🔒 All web browsers  🔒 Focus Agent  🔒 System essentials          │
│  ✓ VS Code  ✓ Slack                         [ Open dashboard ]      │
├─────────────────────────────────────────────────────────────────────┤
│ First-run permission: Granted on 2 Nov 2026            [ Reset ]    │
│ ☐ Start Focus Agent at login — OFF (default)                       │
│   Focus Mode never starts itself. Turn this on only if you want    │
│   the agent available after login. You can switch it off any time. │
│ [ Quit Focus Agent ] ← restores any active focus, then exits        │
└─────────────────────────────────────────────────────────────────────┘
```

Rules: renderer is UI-only (`contextIsolation`, preload exposes `{getState, endFocus, quit, copyCode}`); every state shows icon + text; the code exists **only here** (never over the local channel, never in the dashboard); start-at-login is OFF by default with the text above (REC-008); `Quit` always restores first (INV-5). Window states: **starting** "Starting Focus Agent…"; **unpaired** code + "Enter this code on the dashboard: Devices → Pair a device"; **paired** "Connected to {account email} — ready"; **focusing** countdown + End focus; **error** `capabilities.focus === 'unsupported'` → "Window control isn't available on this system ({reason}). Scheduled sessions won't start here."; after 5 wrong codes → "Too many wrong attempts. Here's a new code: {code}".

### 7.2 Tray / menu-bar menu

```
◇ Focus Mode — Paired
────────────────────────────────
● Focus session running — 42:10 left    (label only when FOCUSING)
End focus                                (enabled only when FOCUSING)
────────────────────────────────
Open Focus Agent
Focus Mode settings… → Allow-list (read-only) · Reset focus permission
Start at login                           ☐  (unchecked default — REC-008)
────────────────────────────────
Quit Focus Agent                         (restores windows first)
```

Tray icon: outline diamond idle/unpaired, filled teal focusing, grey slash disconnected — icon **plus** tooltip `Focus Mode — {state}` and the menu's first line as text (never colour/icon only). Quit while focusing only after `exitFocus()` resolves.

---

## 8. Responsive rules (NFR-006)

Breakpoints: base 360–639 · `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · ≥1440 (content capped 1200 px). **Acceptance at 360×740, 768×1024, 1440×900:** `document.documentElement.scrollWidth <= clientWidth` on every route, no fixed-width element wider than the viewport, no horizontal scroll in dialogs.

| Element | 360 px | 768 px | 1440 px |
|---|---|---|---|
| AppShell nav | top bar: ☰ → slide-over Sheet + title + badge | Sheet from left | persistent 248 px sidebar |
| FocusIndicator | sticky top bar, wraps to 2 lines if needed (bottom bar dropped — ratified §12.4 D6) | sticky top bar | sticky top bar, single line |
| Dashboard grid | 1 column | 2 columns (Start \| Today) | 12-col: Start 7 / Today 5, sessions full |
| Tables | rows become cards (`<dl>` per field) | 2–3 columns | full table, sticky head |
| Dialogs / consent | full-screen sheet, sticky 44 px footer | centred 440 px | centred 440–560 px |
| Countdown ring | 220 px / 10 px stroke | 280 px | 320 px / 12 px stroke |
| Insights | 1 chart per row, 220 px | 2-up | 3-up + session table |
| `/focus` | single column, ring first, End Focus sticky | ring + details 2-up | ring 320 + side panel |
| Touch targets | ≥44×44 (`h-11` <768) | ≥44 | ≥40 |

Also: `min-w-0` on flex/grid children; long values `truncate` + `title`; no `whitespace-nowrap` on user data; the 6-box code input wraps and never exceeds 320 px.

---

## 9. Motion rules

- **Calm only.** 120 ms hover/press · 180 ms toast/popover/tab · 240 ms modal/drawer; `var(--fm-ease-calm)`; no bounce/spring/overshoot, scale ≤ 1.02.
- **No infinite/looping animation** — no pulsing badge, no breathing ring, no shimmer skeletons, no animated gradients. Status is static text; the countdown advances once per second with **no transition** (discrete), calmer and testable.
- **`/focus` is still**: `base` background, only the ring's `stroke-dashoffset` + digits update each second; no confetti or celebration — session end shows a plain success message.
- `prefers-reduced-motion: reduce` → durations collapse to `0.01ms` (in `tokens.css`), no dialog transforms; countdown unchanged (already discrete). Honour it without losing information.
- No scroll-jacking, no autoplay media; P2 ambient sounds (POMO-1) off by default and user-started.

---

## 10. Accessibility rules (NFR-008)

1. **Status = icon + text, never colour alone** — badge, focus indicator, session/device status, notification type. Icons `aria-hidden="true"`; text is the accessible name.
2. **Contrast** — only §1 tokens; pairings audited in §2; axe-core 0 serious/critical on every route (T-084).
3. **Keyboard** — first tab stop "Skip to main content"; order header → sidebar → main → footer; modal focus trap with return focus; Escape cancels (never confirms) the consent modal; End Focus reachable from anywhere (indicator is in the tab order); visible focus ring always (`--fm-ring-width`, 2 px offset, `ring`/`ring-on-base`; never `outline:none` without replacement).
4. **Countdown ring** — `<svg role="img" aria-label="Focus session: 42 minutes 10 seconds remaining">`; visible digits `aria-hidden="true"`; a visually hidden `role="timer" aria-live="polite"` announces at minute granularity and at 30 s / 10 s — never every second. Updates are textual, so reduced-motion users lose nothing.
5. **Forms** — visible `<label>` for every input; `aria-invalid="true"` + `aria-describedby` on errors (message in `danger-text`); error summary `role="alert"` at the top on submit; required fields marked with text, not a bare asterisk.
6. **Toasts** — success `role="status"`, errors `role="alert"`, never auto-dismiss errors, never steal focus.
7. **Language/titles/charts** — plain English, sentence case; `document.title` reflects state (`Focusing — 42 min left — Focus Mode`); `<html lang="en">`; charts expose `aria-label` totals or a summary table (Recharts `accessibilityLayer`).

---

## 11. Open questions for A4 / A0 (max 5)

> All five were answered during the W1/W2 review (§12.4); kept here as the decision trail.

1. **Font** — *Resolved:* system UI stack is implemented (`index.css`), no network font, CSP-safe. Inter is not a v1 dependency.
2. **Notifications bell (FR-025)** — *Resolved (DEC-012 Q2):* no bell in W1/W2; reserved for W5, no fake count rendered.
3. **FocusIndicator on public routes** — *Resolved (DEC-012 Q3, §12.4 D4):* authenticated routes + `/403` only; standalone `/404` shows no indicator.
4. **`StartFocusCard` when no agent** — *Resolved:* disabled button + inline reason (`aria-describedby`) + §6.4 card. The current W1 reason copy is stale and must be replaced (F-01/F-03).
5. **`/settings` scope** — *Resolved:* no account deletion in v1; start-at-login stays in the Focus Agent tray (REC-008). Unpair-all/password change remain P0 for T-072 (Phase 5).

---

## 12. Implementation review — W1/W2 (A3)

> **Task:** W2 UX review requested by A0 (branch `feat/a3-ux-review`) · **Method:** read-only review of the merged `client/`; A3 edited **only this document**.
> **Evidence:** every file cited below was opened in this review; `npm test --workspace=@focus-mode/client` → **11 files / 42 tests passed** (1.56 s). No client code was changed by A3. Snapshot: the W1/W2-merged working tree; the `e2e/` suite (A8/A9) landed during the review and is covered in rows 14/21.
> **Result vocabulary:** **PASS** = implemented as specified · **DRIFT** = differs from this spec (action or ratification listed) · **DEFERRED** = deliberately outside W1/W2 scope per IMPLEMENTATION_PLAN, not a defect (owning task named). A PASS is a *spec-conformance* judgement, never a claim that a feature works at runtime.

### 12.1 Checklist

| # | Area | Spec ref | Result | Note / evidence |
|---|---|---|---|---|
| 1 | Colour tokens (`client/src/index.css` `@theme`, 10–82) | §1.2, §1.4 | **PASS** | 45/45 `--color-*` tokens present with values identical to the spec (case-insensitive compare); 0 missing, 0 extra, 0 mismatches. |
| 2 | Non-colour tokens (`client/src/styles/tokens.css` 9–61) | §1.3 | **PASS** | Every `--fm-*` token present and equal; reduced-motion collapse included; no hex added here. |
| 3 | Colour discipline / contrast intent | §1.5, §2.2 | **PASS** | `grep '#[0-9A-Fa-f]{6}' client/src/**/*.tsx` → 0 hits; every fill/text combination maps to an audited §2 pair (primary/danger/focus-strong + white, `danger-text`, `amber-text`, `border-strong`, disabled pair). Only note: raw `danger #DC2626` is used as the *icon* colour on `bg-danger-subtle` (4.41:1) in `error-state.tsx:38` and `forbidden.tsx:30` — legal at ≥3:1 for a graphic, must never become text. |
| 4 | `AgentStatusBadge` (`components/agent/agent-status-badge.tsx`) | §3, §10.1 | **PASS** | Icon + text, `role="status"`, `aria-live="polite"`, `aria-label`, `Disconnected` opens the help card. Ratified additions: `IDLE → "Not paired"` and the `detail` sentence tooltip (D2). |
| 5 | `FocusIndicator` (`components/agent/focus-indicator.tsx`) | §3, §4.4 | **PASS** | Renders only when `status==='FOCUSING' && session!==null`; countdown derived from `endsAt`; 1 s discrete update with no transition; icon + text; real `exitFocus` on End Focus; visible on every AppShell route incl. `/403`. Known gap: no "Lost contact" warning if the link drops mid-session (F-02). |
| 6 | Provider auth gating (`agent/agent-link-provider.tsx` 305–346) | §3 / DEC-012 Q3 | **PASS** | Socket opens only when `authStatus === 'authenticated'`; disposed + state reset on logout; status vocabulary from `@focus-mode/shared`; `connectFailed` sets `helpCardVisible`. |
| 7 | `AgentHelpCard` (`components/agent/agent-help-card.tsx`) | §6.3 | **PASS** (1 copy note) | Title, body, Chrome/Edge, Firefox, Safari, "Still not connecting?" 2–3 and both buttons verbatim. Step 1 wording differs — ratified to the implementation (D3); `Dismiss` + full-width placement ratified (D3). |
| 8 | `/devices` page (`pages/devices.tsx`) | §4.5, §6.1 | **PASS** | All four states; empty title and error title verbatim; 5 s background refetch; capability line shown honestly. Deferred: `Download Focus Agent` action and the "allow-list v3" line from the wireframe (F-07, T-072). |
| 9 | Pair dialog (`components/devices/pair-dialog.tsx`) | §4.5, §6.2 | **PASS** | Title/description/hint exact; digits-only, max 6, autofocus; submit disabled until 6 digits; "Pairing…" loading; `INVALID_PAIRING_CODE`/`PAIRING_EXPIRED`/`VALIDATION_ERROR` surface as field errors (ratified interpretation of the wireframe's error slot); toast "Agent connected" exact. |
| 10 | Unpair dialog (`components/devices/unpair-dialog.tsx`) | §4.5 | **PASS** | Title and confirmation sentence exact; destructive confirm; toast "Device unpaired"; extra explanatory sentence approved. |
| 11 | `/login` (`pages/login.tsx`) | §4.2, §6.2 | **PASS** | "Welcome back"/"Log in"/"Logging in…"/"New here? Sign up →"; `details[]` → inline fields; 401/403/409/429 mapped; 60 s rate-limit countdown; "Signed in" + redirect to the attempted route. 401 copy ratified (D1). |
| 12 | `/signup` (`pages/signup.tsx`) | §4.2 | **PASS** | "Create your account"/"Creating account…"/"Already have an account? Log in →"; 409 copy exact; success → `/dashboard?welcome=1`; password hint wording ratified (D7). |
| 13 | NFR-007 states on data screens | §4.x, §6.1 | **PASS** except `/focus` | Dashboard, devices, allow-list, schedules, insights, settings, admin each render loading (static skeleton + `sr-only` label), empty, error (`role="alert"` + Retry, code as muted ref) and success. `/focus` renders only the empty state even while a real session is running (F-02). Static pages correctly render no states. |
| 14 | NFR-006 at 360 px (static inspection) | §8 | **PASS** (provisional) | No viewport-scale fixed widths; `flex-wrap` + `min-w-0` + `truncate` throughout; drawer nav with focus trap < 1024; primary controls 44 px below `md` (the `sm` variant is 40 px mobile / 36 px desktop → F-06). One deviation: the insights daily table scrolls inside its own `overflow-x-auto` instead of becoming card rows (F-05). The `e2e/` suite (A8/A9: `smoke.spec.ts`, `pairing.spec.ts`) has **no viewport/scrollWidth test yet**, so the §8 assertion is unproven until T-085 — PASS here is static only. |
| 15 | Motion | §9 | **PASS** | Static skeletons/spinner (no shimmer), no infinite animation, durations/easing from tokens, reduced-motion collapse in `tokens.css`. |
| 16 | Accessibility (W2 subset) | §10 | **PASS** with notes | Skip link, 2 px focus rings with offsets, dialog focus trap + return focus + Escape, `label`/`aria-invalid`/`aria-describedby`, error toasts with `duration: Infinity`. Note: the badge wrapper carries `aria-label` *and* live child text, which can double-announce (F-08, T-084). Countdown-ring rules (§10.4) have no implementation yet. |
| 17 | Role-aware nav + guards | §3, §4.10 | **PASS** | USER sees 7 items; ADMIN also sees `Admin`; `RequireRole` sends USER to `/403` inside the shell; react-query/API still enforce 403 server-side. |
| 18 | W3+ scope | §4.3–§4.10 | **DEFERRED** | Not built (correctly, with no fake values): dashboard Today card/consent/Start wiring, `/focus` session UI, allow-list editor + presets, schedules CRUD, settings edit/password/unpair-all, admin tabs/search/actions/stats, landing download links + nav anchors, Recharts, notification bell, Focus Agent window/tray. |
| 19 | Copy discipline | §6.1 | **DRIFT** | Internal milestone/task jargon is rendered to users on 8 routes → **C-01**; insights error exposes an implementation rationale → **C-02**. Must be fixed before the W3 demo. |
| 20 | Client tests | — | **PASS** | 42/42 green; they assert badge labels (incl. "Not paired"), End Focus wiring, devices empty/error copy and login flows. None assert the jargon strings, so C-01 removal causes no test churn. |
| 21 | E2E (A8/A9) | §4.5, §6.1 | **PASS** (coverage noted) | `e2e/pairing.spec.ts` + `e2e/smoke.spec.ts` exist and assert the accessible names `Focus Agent status: Connected`, dialog names, and the exact strings "Agent connected", "Device unpaired", "No device connected — start your Focus Agent". C-01 replacements must (and do) leave those strings untouched; F-08 must keep the `Focus Agent status: …` accessible name stable. |

### 12.2 Copy regressions / drift

**C-01 (HIGH) — internal development jargon in rendered UI.** Violates §6.1 ("no internal codes, no stack-trace/branch jargon") and is now *stale*: W2 merged the agent link and the pairing dialog, so several sentences are factually wrong. Exact strings (all verified in the files, all user-visible):

| # | File:line | Current rendered string | Replacement |
|---|---|---|---|
| 1 | `pages/dashboard.tsx:53-55` | "Starting a session needs the live Focus Agent link — it lands in W2 (T-045). The Focus Agent is what actually moves windows aside, so nothing is started from here yet." | "Connect the Focus Agent to start a session. The Focus Agent moves windows aside — the dashboard never touches your operating system." |
| 2 | `pages/dashboard.tsx:148-150` | "The download links and the pairing dialog land in W2; this checklist is here so the first-run path is visible, not implied." | Delete (the pairing dialog exists now); keep the 3-step list. |
| 3 | `pages/allowlist.tsx:105-107` | "Allow-list version {n}. Editing, manual app add and presets land with T-034 (W2) — this view is read-only today." | "Allow-list version {n}. Editing and adding apps aren't available yet." |
| 4 | `pages/schedules.tsx:33-35` | Badge text "Read-only in W1" | Remove the badge (a phase label is not user copy); keep the list. |
| 5 | `pages/schedules.tsx:60` | "Creating schedules lands with T-035 (W2). A scheduled session starts only while your Focus Agent is connected, and only after a 10-second heads-up you can cancel." | "A scheduled session starts only while your Focus Agent is connected, and only after a 10-second heads-up you can cancel." |
| 6 | `pages/schedules.tsx:98-100` | "Creating, editing and enabling schedules land with T-035 (W2) — this list is read-only today." | "Creating and editing schedules aren't available yet." |
| 7 | `pages/focus.tsx:37` | "The live countdown ring and End Focus land with T-031 / T-045 (W2)." | Delete; the empty-state description already explains the next step. |
| 8 | `pages/insights.tsx:180-182` | "The Recharts daily-focus chart lands with T-033 (W2). This table is the accessible equivalent of the same data, so no numbers are guessed." | "This table is the accessible view of your daily focus minutes." |
| 9 | `pages/settings.tsx:64` | "Read-only in W1. Editing lands with T-036." | "Profile editing isn't available yet." |
| 10 | `pages/settings.tsx:78-80` | "Email is managed by your account; changing it needs an admin. Profile editing, password change and unpair-all land with T-036 (W2)." | "Email is managed by your account; changing it needs an admin. Profile editing, password change and unpair-all aren't available yet." |
| 11 | `pages/admin.tsx:45-47` | Badge text "Search and filters land with T-073" | Remove the badge. |
| 12 | `pages/admin.tsx:109-111` | "Deactivate/activate, presets, download links and aggregate stats land with T-073 (W3) — this users list is read-only today." | "User management actions, presets, download links and aggregate stats aren't available yet." |
| 13 | `pages/landing.tsx:97-100` | "W1 placeholder: the complete landing page, installer detection and download buttons land with T-028. The dashboard routes behind Log in are real." | Delete the paragraph entirely (never ship a placeholder note). |
| 14 | `pages/landing.tsx:139-141` | "…come from the public /agent-links API. Until an admin publishes them, no fake installer is offered here." | "An admin publishes the macOS, Windows and Linux installers." |

**C-02 (LOW) — error message leaks implementation rationale.** `pages/insights.tsx:96`: "Your last known numbers are not shown because this dashboard does not keep a stale cache." → **"Check your connection and try again."** (§6.1 error copy; title already says "We couldn't load your insights.").

**C-03 (RATIFIED, no fix) — help-card step 1.** Spec wording "Is the Focus Agent running? Its tray icon should be visible." is implemented as "Start your Focus Agent and leave it running — its tray icon should be visible." The implementation is more actionable and is now the spec (§6.3 amended).

### 12.3 Decisions ratified / overridden (explicit reply to A0's three questions)

| ID | Question | Decision | Consequence |
|---|---|---|---|
| **D1** | Login 401 copy | **RATIFIED:** `"Email or password is incorrect."` (exact, sentence case, no exclamation mark). Keep `ERROR_MESSAGES.UNAUTHENTICATED` = "Your session has expired. Please log in again." for session-expiry paths only. | §6.2 gained a login-form-only 401 row. A4 keeps `LOGIN_REJECTED_COPY` in `copy/errors.ts:38`. |
| **D2** | Final badge label set | **RATIFIED:** `Connected` (PAIRED) · `Disconnected` (DISCONNECTED) · `Focusing` (FOCUSING) · `Connecting…` (first seconds) · **plus `Not paired`** for `IDLE` (agent reachable but not linked to this account — honest, not a failure state). Tooltips stay the provider's `detail` sentences (no device-name interpolation before attestation). | §3 badge table amended with the IDLE row + tooltip rule. No A4 change. |
| **D3** | LNA help card verbatim? | **VERIFIED:** title, body, Chrome/Edge, Firefox, Safari row, "Still not connecting?" steps 2–3 and both buttons are verbatim; only step 1 drifted (C-03). **RATIFIED:** implementation wording, extra `Dismiss` control, and full-width card placement above `<main>` content instead of a badge popover. | §6.3 amended. No A4 change. |
| **D4** | FocusIndicator visibility (DEC-012 Q3) | **RATIFIED:** authenticated routes + `/403`; no indicator on `/`, `/login`, `/signup`, or standalone `/404` (public catch-all). | §3 + §4.11 amended (404 now documented as standalone). |
| **D5** | `focusRejected` copy | **RATIFIED:** `UNSUPPORTED` drops the `{reason}` placeholder (never surface raw agent text); add local `ALREADY_FOCUSING` (reuses API string) and `UNAUTHENTICATED` ("Your Focus Agent needs to be verified again. Pair it on Devices."). | §6.2 local table amended. |
| **D6** | Mobile FocusIndicator placement | **RATIFIED:** sticky top bar at all widths (bottom bar dropped — it risked covering the dialog footer at 360 px). | §8 table amended. |
| **D7** | Small vocabulary/behaviour choices | **RATIFIED:** session badges `Active/Completed/Cancelled`, device badges `Connected/Disconnected/Focusing`; password hint "8–72 characters, at least one letter and one digit."; pairing errors rendered as field errors rather than a generic banner slot; no-device empty state as numbered description + footnote until installer URLs exist (T-072). | No code change; recorded here so later reviews don't re-flag them. |

### 12.4 Fixes for A4 (W3)

| ID | Severity | File:line | Fix |
|---|---|---|---|
| **F-01** | **HIGH** | files in C-01 table | Replace/remove the 14 milestone-jargon strings (§12.2). Test-safe: no test asserts them. Do this even before the W3 feature work — user-visible dev copy is a demo risk. |
| **F-02** | MED | `pages/focus.tsx` (whole file), `agent/agent-link-provider.tsx:259-267, 243-249` | Build the §4.4 live panel: ring + remaining time + stays-open/stepped-aside summary + large End Focus, driven by `useAgentLink().session`. Add the "Lost contact with your Focus Agent…" warning (§4.4 error state); the provider currently drops `session` on `connectFailed`, so retain a `lastSession`/`linkLost` flag. (T-057) |
| **F-03** | MED | `pages/dashboard.tsx:26-71, 181-185` | Replace stale Start-card copy; add the Today card (today's focus time, streak, next scheduled session — FR-013/§4.3); wire duration chips + `ConsentModal` (T-056/T-065). |
| **F-04** | LOW | `pages/insights.tsx:93-100` | Replace the rationale error message with "Check your connection and try again." (C-02). |
| **F-05** | LOW | `pages/insights.tsx:150-178` | At < 640 px convert the daily table to card rows (§8) or keep internal scroll and record the exception in §8. |
| **F-06** | LOW | `components/ui/button.tsx:30` | `sm` size is 36 px at ≥ md (`md:h-9`) but §8 requires ≥ 40 px on desktop; affects the FocusIndicator End Focus. Use `md:h-10` (or accept 36 px in §8 if intentional). |
| **F-07** | LOW | `pages/devices.tsx:81-91, 152-160` | Add the §4.5/§6.4 download actions and allow-list version line once `/agent-links` is live (T-072, Phase 5). |
| **F-08** | LOW | `components/agent/agent-status-badge.tsx:38-42` | T-084 a11y pass: avoid `aria-label` + live child text double-announcement. Keep the accessible name pattern `Focus Agent status: …` — `e2e/pairing.spec.ts:127` and `e2e/smoke.spec.ts:46` depend on it. |
| **F-09** | INFO | `pages/landing.tsx:44-61` | Add "How it works"/"Download" section anchors when the full landing page lands (T-028); the help card already links `/#downloads-heading`. |

### 12.5 Not verifiable statically / residual risks

- **NFR-006** — the 360/768/1440 `scrollWidth` assertion (§8) is not automated yet: `e2e/` has pairing/smoke specs but no viewport test. Static inspection found no overflow risk, so the PASS above is provisional (T-085).
- **NFR-008 contrast** — PASS is token-level: the 45 implemented tokens are value-identical to the audited set, so §2 ratios carry over; only an axe run on rendered pages proves computed styles (T-084).
- **Behavioural claims** — the 42 unit tests cover components and the link/session data path with mocks; pairing → focus → end against a real agent is still unproven by this review (T-093 E2E, Phase 8 manual).
- **Deferred areas** — §4.3 dashboard Today, §4.4 session UI, §4.5 download actions, §4.6 editor/presets, §4.7 CRUD, §4.9 edit/password/unpair-all, §4.10 tabs/search/actions, §7 agent window/tray are **unverified**, not passing; re-review them at the W3/W4 gate.
- **Spec deltas applied by this review:** §3 badge table + FocusIndicator paragraph, §4.11, §6.2 (login 401 row + local-channel table), §6.3, §8 FocusIndicator row, §11 resolved questions. No other normative text changed.

---

## 13. W4/W5 implementation review (A3)

> **Task:** task-37 / W5-UX (branch `feat/a3-w5-review`) · **Method:** read-only review of the working tree; A3 edited only this document. No source edits, no git.
> **Snapshot: 2026-11-10 22:47–22:48 IST.** W4 pages (`dashboard`, `allowlist`, `schedules`) mtime 22:07; `/focus` 21:29. **W5 is in flight and landed while this review was written:** `notification-bell.tsx`, `app-shell.tsx`, `insights.tsx` + `components/insights/focus-chart.tsx` at 22:46; `settings.tsx` was rewritten to 583 lines at 22:47 *after* the 121-line read-only version I inspected. `admin.tsx` and `landing.tsx` were still the pre-W5 versions (21:29) when inspected. Every W5 item is **PENDING**, never PASS; each row states exactly what was on disk when inspected, and all W5 rows must be re-reviewed after the merge (F-112).
> **Evidence:** 20 client test files / **125 tests passed**, incl. the F-01 copy guard (`copy/user-facing-copy.test.ts`, 5 tests); 45/45 colour tokens identical to §1.4; `grep` → 0 raw hex in `*.tsx`; rendered-string jargon sweep → 0 (all `W1/T-0xx` hits are comments). W4 state tests: dashboard 6, allowlist 15, schedules 10, focus 6, consent 5, start-card 7. E2E specs (`focus`, `schedule`, `session-reporting`, `pairing`, `smoke`, `api-sessions`) were read for copy coupling.
> **Vocabulary:** **PASS** = merged W4 area conforms · **DRIFT** = differs from this spec (action or ratification) · **PENDING** = not yet on disk or W5 in flight — not a defect and never a pass.

### 13.1 Checklist

| # | Area | Spec ref | Result | Note / evidence |
|---|---|---|---|---|
| 1 | `/dashboard` real widgets | §4.3 | **PASS** | Start + Today + Recent sessions, per-widget loading / empty / error + Retry / success; today window from the user's local day; no invented numbers. |
| 2 | `/dashboard` Today card completeness | §4.3 wireframe | **DRIFT (LOW)** | Streak is not shown on the dashboard (it lives on `/insights`). Add with T-071 wiring or accept (R5). |
| 3 | `StartFocusCard` + `DurationChips` | §4.3, §5, FR-007 | **PASS** | 25/50/60 + custom 1–480 with `aria-pressed`; every blocked case has a visible reason bound by `aria-describedby`; no dead click; F-01-approved sentence rendered. |
| 4 | Start with allow-list not loaded | §4.3, §5, FR-020 | **DRIFT (MED)** | Start is enabled while the allow-list query is pending/failed; `enterFocus` then sends `userApps: []` and the modal claims "none yet" when the truth is "unknown". Fix F-101. |
| 5 | `ConsentModal` copy + structure | §5, FR-009 | **PASS** | Five sections, duration row, fine print and the single `Confirm — start focus` are verbatim; title carries the ratified `-minute` form (R2); first-run sentence is agent-side only (R1). |
| 6 | Consent gate semantics | §5, FR-009 | **PASS** | Nothing is sent before Confirm (E2E asserts no ACTIVE session pre-confirm); Escape/backdrop cancel; re-aside toggle default ON. |
| 7 | `/focus` live session view | §4.4, §10.4 | **PASS** | Ring counts from `endsAt`; `role="img"` sentence; polite live region at minute + 30 s/10 s; End Focus 48 px; ended summary; loading + empty states; F-02 "Lost contact" banner with retained session verified in tests. |
| 8 | `/focus` stepped-aside summary | §4.4 wireframe | **DRIFT (LOW)** | Shows "Minimised, not closed · re-aside: on" but omits the app count the wireframe asks for. Fix F-103. |
| 9 | Focus ring visual tokens | §1.3 | **DRIFT (LOW)** | `strokeWidth=4` in a 120-unit viewBox ≈ 7 px at 220 px vs the §1.3 10 px token (visual only). Fix F-104 or ratify (R7). |
| 10 | `FocusIndicator` | §3, §10.7 | **PASS** | Sticky top bar; connected + link-lost states; remaining time; End Focus; `document.title` cue; never vanishes mid-session. |
| 11 | `FocusIndicator` live semantics | §10 | **DRIFT (LOW)** | The `role="timer"` wrapper contains the Reconnect/End Focus buttons. Fix F-105 (T-084). |
| 12 | `/allowlist` locked protected rows | §4.6, INV-3 | **PASS** | Lock icon + "Protected" text badge, no remove/edit control; test asserts the control's absence. |
| 13 | `/allowlist` editor, presets, add dialog | §4.6, FR-020, REC-007 | **PASS** | Remove/add via PUT, merge/replace presets with confirmation, 50-app limit reason, running-apps picker (labels only), `PROTECTED_ENTRY` inline; 15 state tests. |
| 14 | `/allowlist` chip remove target | §8 | **DRIFT (LOW)** | 32×32 px remove button < 40/44 px. Fix F-106. |
| 15 | `/schedules` CRUD + timezone | §4.7, FR-012 | **PASS** | Create/edit/toggle (switch role)/delete + confirm; next-run line; "no Focus Agent" warning; four states; 10 tests. |
| 16 | `/schedules` validation copy | §6.1 | **DRIFT (LOW)** | `startTime` surfaces the raw shared message "startTime must be 24-hour HH:mm…". Fix F-102. |
| 17 | Copy deck / no internal jargon | §6.1 | **PASS** | F-01 fix verified by the regression test + manual sweep: no rendered `W#`/`T-0xx`/`read-only in W` copy anywhere. |
| 18 | Colour tokens / contrast intent | §1, §2 | **PASS** | 45/45 tokens identical; 0 raw hex in `*.tsx`; fills/text use audited pairs; raw `danger` appears only as an icon on `danger-subtle` (4.41:1 ≥ 3:1 graphic). |
| 19 | NFR-007 on W4 pages | §4.x, §6.1 | **PASS** | Loading skeletons (static), empty, error (`role="alert"` + Retry + muted code) and success per card/widget; proven by the page tests. |
| 20 | 360 px on W4 pages | §8 | **PASS** (static) | `flex-wrap` / `min-w-0` / `break-words` throughout; dialogs are full-width bottom sheets; no fixed width exceeds the viewport. Formal Playwright viewport spec still missing (F-110). |
| 21 | Error/toast copy | §6.2 | **PASS** | `copyForError` used for mutations; error refs muted; errors `role="alert"` except F-107. |
| 22 | Badge vocabulary | §3 | **PASS** | Session Active/Completed/Cancelled; device Connected/Disconnected/Focusing; schedule Enabled/Disabled as a switch + badge; notification read state as text. |
| 23 | W2 fix carry-over (§12.4) | — | **PASS** (partial) | F-01 fixed (test-enforced), F-02 fixed, F-03 fixed, F-04 fixed, F-06 fixed (desktop 40 px). Still open: F-05 (W5 insights), F-07 (downloads), F-08 (T-084), F-09 (W5 landing). |
| 24 | `/insights` | §4.8 | **PENDING** | W5 file landed at 22:46 mid-review: metrics + range tabs + `FocusChart` (Recharts) with `aria-hidden` bars, an `sr-only` summary sentence and a `<details>` table alternative — looks conformant, but **not PASS until W5 merge**. Old F-05 (card rows vs scroll) may now be moot: the visible table is inside a disclosure; verify at merge. |
| 25 | `/settings` | §4.9 | **PENDING** | The inspected version (121 lines, 21:29) was still read-only (profile/password/unpair-all/downloads absent). It was rewritten to 583 lines at 22:47 while this review was being written, so the new editor + downloads UI is **not reviewed** — verify at merge. |
| 26 | `/admin` | §4.10 | **PENDING** | Snapshot is users-list-only (no tabs/search/pagination/actions/presets/agent links/stats); admin hooks appeared at 22:47. Empty copy mentions filters that do not exist yet (F-108). |
| 27 | `/landing` | §4.1 | **PENDING** | Snapshot hero/steps/promise are real but installer links, `How it works`/`Download` nav anchors and footer links are missing (T-076). |
| 28 | Notifications bell + panel | §3, FR-025 | **PENDING** (in flight) | `notification-bell.tsx` + `use-notifications.ts` + header mount landed 22:46. Current file has four states, unread count derived from data (no invented number), bell `aria-label` includes the count, no notifications → "No notifications yet. Missed scheduled sessions will show up here." Not PASS until W5 merge; one a11y note F-109. |
| 29 | Installer/download actions | §4.5, §4.9, §6.4, F-07 | **PENDING** | At inspection time (devices 21:29, settings 21:29 version) there was no `Download` button on the `/devices` card and none in `/settings`; `components/settings/download-links.tsx` and agent-link hooks were appearing during the review, so downloads may be landing now (T-072/T-076/T-122). |
| 30 | E2E copy locks | §5, §6 | **PASS** (read, not run) | E2E depends on: consent dialog name `Start a {n}-minute focus session?`, headings "These stay open" / "You can end focus any time", `Confirm — start focus`, "Agent connected", "Device unpaired", "No device connected — start your Focus Agent", "Focus Agent status: ", "Focus started", "Focus ended — your windows are back.". Do not reword these. |

### 13.2 Copy drift list (exact old → new)

Rendered-string drifts found in merged W4 code: **5** (1 MED, 4 LOW), plus 1 comment-only housekeeping item.

| ID | File:line | Current (rendered) | Replace with | Severity |
|---|---|---|---|---|
| C-101 | `components/focus/start-focus-card.tsx:68, 87–99, 151–155` | Start enabled while allow-list is unknown; consent modal says "Your allow-listed apps: none yet" | Disable Start while the allow-list query is pending/error; reason: "Your allow-list couldn't be loaded. Retry before starting focus." | **MED** |
| C-102 | `components/schedules/schedule-dialog.tsx:186–194` | "startTime must be 24-hour HH:mm, e.g. 09:00" | "Use 24-hour HH:mm, for example 09:00." | LOW |
| C-103 | `pages/focus.tsx:144–154` | "Minimised, not closed · re-aside: on" | "Stepped aside: {n} apps — minimised, not closed · re-aside: on" (§4.4) | LOW |
| C-104 | `components/focus/consent-modal.tsx:110–200` | (no first-run sentence) | No string change if R1 is ratified; otherwise add the conditional line above the footer | LOW |
| C-105 | `pages/admin.tsx:67–73` | "No users match your filters." | "No users yet." until T-074 adds real filters | LOW |
| C-106 | `copy/errors.ts:32–38` | Comment calls `LOGIN_REJECTED_COPY` "PROVISIONAL" | Comment: ratified in §12.4 D1 (non-user-facing) | INFO |

### 13.3 Ratification decisions for A0

| ID | Decision | Recommendation / rationale |
|---|---|---|
| **R1** | First-run sentence in the dashboard consent modal | **Ratify omission.** The agent's stored consent is agent-local (§5.1/§7.1), so the page cannot honestly say "first time on this device"; the native dialog is the true first-run gate and the agent window shows the stored status. §5 amended. If A0 wants the page to show it, add `consentGranted` to `hello` — an A2 contract change, not W5. |
| **R2** | Consent title word order | **Ratify** "Start a {duration}-minute focus session?" (natural English; E2E-locked). §5 amended. |
| **R3** | `/focus` "Stays open" content | **Ratify** fixed categories ("All web browsers · The Focus Agent · System essentials") + the user's allow-list labels. The dashboard must not invent an OS app inventory; this matches §5 wording. |
| **R4** | Extra operational copy in W4 pages | **Ratify** the additions: "Needs a connected Focus Agent to start. Missed runs appear in notifications, not here.", "Removing an app takes effect the next time focus starts.", "{n} of 50 apps", delete/replace confirmation sentences. All §6.1-compliant. |
| **R5** | Dashboard streak | **Accept for W4**, add when the insights query is wired (`T-071`) — or leave on `/insights`; not a wave blocker. |
| **R6** | Notification copy (new strings) | **Approve** "No notifications yet.", "Missed scheduled sessions will show up here.", "All read", "{n} unread". §6.1-compliant; add to the copy deck when W5 merges. |
| **R7** | Focus-ring stroke via viewBox units | **Ratify the visual** (scales with the ring, never overflows 360 px) or fix F-104 in T-084 polish; no a11y impact. |

### 13.4 Ordered fix list for A4/A8

| Order | ID | Owner | File:line | Fix |
|---|---|---|---|---|
| 1 | **F-101** | A4 | `components/focus/start-focus-card.tsx:68, 87–99, 151–155` | Block Start while the allow-list is pending/error; visible reason + `role="alert"` for the fetch error (C-101). Safety-adjacent: prevents starting with an unknown allow-list. |
| 2 | F-102 | A4 | `components/schedules/schedule-dialog.tsx:71–79, 186–194` | Friendly `startTime` error via `displayError` (C-102). |
| 3 | F-103 | A4 | `pages/focus.tsx:144–154` | Add the stepped-aside count from the agent's `listApps` snapshot (C-103). |
| 4 | F-104 | A4 | `components/focus/focus-ring.tsx:34–52` | Derive stroke width from `--fm-ring-stroke-*` or document viewBox scaling in §1.3 (R7). |
| 5 | F-105 | A4 | `components/agent/focus-indicator.tsx:67–104` | Replace wrapper `role="timer"` with `region`/`status` around non-interactive content; keep actions outside live semantics (T-084). |
| 6 | F-106 | A4 | `pages/allowlist.tsx:42–49`; `components/agent/focus-indicator.tsx:100` | ≥44 px mobile / ≥40 px desktop targets for `AppChip` remove and the indicator's `End Focus` (`sm` = 40 px). |
| 7 | F-107 | A4 | `components/focus/start-focus-card.tsx:151–155` | Use `role="alert"` for the allow-list fetch error (currently `role="status"`). |
| 8 | F-108 | A4 | `pages/admin.tsx:67–73` | Empty copy "No users yet." until filters exist; T-074 restores filter wording (C-105). |
| 9 | F-109 | A4 | `components/layout/notification-bell.tsx:126–202` | Popover declares `role="dialog"` but does not move focus into it or trap it; move focus into the panel on open (or use non-modal menu semantics) (T-084). |
| 10 | **F-110** | A8/A9 | `e2e/` (new spec) | Add the NFR-006 viewport spec: 360×740, 768×1024, 1440×900, assert `document.documentElement.scrollWidth <= clientWidth` on every route (T-085). No viewport spec exists (grep `scrollWidth|setViewportSize` in `e2e/` → 0). |
| 11 | F-111 | A4 | `copy/errors.ts:32–38` | Update the stale "PROVISIONAL" comment (C-106). |
| 12 | F-112 | A4/A3 | §13.1 rows 24–29 | After the W5 merge, re-review insights / settings / admin / landing / notifications / downloads; re-run the copy guard and check the mobile chart/table. |
| 13 | F-113 | A4 | `components/agent/agent-status-badge.tsx:38–42` | F-08 carry: `aria-label` + live child text can double-announce; keep the `Focus Agent status: …` name stable (E2E depends on it) (T-084). |

### 13.5 W5 items on disk as PENDING — verify after merge

| Area | Must be true | Files |
|---|---|---|
| `/insights` | Recharts chart keeps the `sr-only` summary + `<details>` table alternative; empty copy; 360 px layout; range switch `aria-busy` | `pages/insights.tsx`, `components/insights/focus-chart.tsx` |
| `/settings` | Profile edit, password change, unpair-all (confirm), installer download buttons; validation + success toasts; start-at-login stays agent-side | `pages/settings.tsx`, `components/settings/download-links.tsx`, `hooks/use-account.ts` |
| `/admin` | Tabs Users/Presets/Agent links/Stats; search + pagination; deactivate/reactivate; no per-user session detail; aggregate stats only | `pages/admin.tsx` + `hooks/use-admin-*` |
| `/landing` | Real installer links from `/agent-links` (no invented versions), `How it works` + `Download` anchors, footer links | `pages/landing.tsx` |
| Notifications | Four states, unread count from data, panel keyboard handling (F-109); no fake badge | `components/layout/notification-bell.tsx` |
| Downloads | `Download Focus Agent` on the device card and in settings (§4.5/§6.4, F-07) | `pages/devices.tsx`, `pages/settings.tsx` |
| Quality gates | Copy guard green, axe 0 serious/critical (T-084), viewport E2E (F-110) | `e2e/`, client tests |

### 13.6 Limits of this review

- The W5 target is a **moving working tree** (at least five W5 files landed while this section was being written, including a full `/settings` rewrite after inspection). Only the W4 pages are merged and can be called PASS; W5 rows are deliberately PENDING and the in-flight observations are not verdicts.
- No real-browser checks were run: the 360 px verdict is static analysis; the `scrollWidth` assertion is F-110.
- No axe run (T-084), no E2E execution; the E2E copy coupling was read from the specs, not executed.
- W2 fixes verified present: F-01, F-02, F-03, F-04, F-06. Open by design: F-05 → W5 (partly moot), F-07 → downloads, F-08 → T-084, F-09 → W5 landing.
- Spec deltas applied by this review: **§5 only** (ratified consent title + first-run paragraph). Everything else is recorded in §13 and needs no normative change.
