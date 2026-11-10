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
| `CONNECTED` / `PAIRED` | `CheckCircle2` | `Connected` | `badge-success-bg` / `#166534` | tooltip "Focus Agent connected: {device}" |
| `DISCONNECTED` | `CircleSlash2` | `Disconnected` | `badge-neutral-bg` / `#475569` | click → help card §6.3 |
| `FOCUSING` | `Target` | `Focusing` | `badge-focus-bg` / `#115E59` | tooltip "Focusing — 42:10 remaining" |
| `CONNECTING` (first 5 s) | `Loader2` (static) | `Connecting…` | neutral | disappears when resolved |

`aria-label="Focus Agent status: Connected"`, `aria-live="polite"` on the label. User-facing copy always says **Focus Agent**, never bare "agent" (AGENTS.md §0).

**`FocusIndicator`** — persistent on every authenticated route **and** `/403` + `/404`; not on `/`, `/login`, `/signup`. Bottom-fixed bar < 768, sticky top bar ≥ 768. Shows teal mark + "Focusing" + remaining minutes (from agent `endsAt`) + `End Focus` (always enabled). No animation, no live region (the badge already announces).

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
```
/403 (inside AppShell)                    /404
┌────────────────────────────────────┐   ┌───────────────────────────────────┐
│  ⛔ 403 — You don't have access    │   │ 404 — We couldn't find that page   │
│  This page is for administrators.  │   │ The link may be wrong or the page  │
│  If that's wrong, ask an admin to  │   │ may have moved.                    │
│  update your role.                 │   │ [ Back to dashboard ] [ Go home ]  │
│  [ Back to dashboard ] [ Sign out ]│   └───────────────────────────────────┘
└────────────────────────────────────┘
```
**loading / empty / success** n/a (rendered synchronously by `RequireRole` / catch-all `*`; FocusIndicator still visible when focusing) · **error** these *are* the error pages; also used for API `FORBIDDEN` navigations.

---

## 5. Consent modal — exact copy (FR-009, before **every** start)

Single **Confirm** button, no checkbox; no `enterFocus` before Confirm; Cancel/Escape/backdrop = cancel; scrollable body with sticky footer at 360 px. `ConsentModal.tsx` (T-056) — copy verbatim, `{placeholders}` from the selected duration/device/allow-list.

```
Title:   Start a {duration} focus session?
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

First run on this device only (append above footer):
  First time on this device: your Focus Agent will also ask you to allow
  this in its own window.

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

Local-channel `focusRejected` codes reuse this shape; these four strings go in `AgentLink` error handling:

| Local code | Message |
|---|---|
| `NOT_PAIRED` | "Your Focus Agent isn't paired to this account yet. Pair it on Devices." |
| `CONSENT_REQUIRED` | "Confirm the first-run permission in the Focus Agent window, then try again." |
| `UNSUPPORTED` | "Your Focus Agent can't move windows on this system ({reason}). Focus needs Windows, macOS, or Linux with X11." |
| `INVALID` | "The Focus Agent rejected that request. Try again — if it keeps happening, restart the Focus Agent." |

### 6.3 Local-network help card (S-4 / T-045) — "Can't reach your Focus Agent"

Shown in the badge popover, `/devices`, and the FocusIndicator when the WS connect fails.

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
  1. Is the Focus Agent running? Its tray icon should be visible.
  2. Does the agent window show a pairing code or "Paired"?
  3. Reload this page. If it still fails, restart the Focus Agent.
Buttons: [ Reload page ]   [ Open download page ]
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
| FocusIndicator | fixed bottom bar (2 lines), End Focus full-width beside time | sticky top bar | sticky top bar, single line |
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

1. **Font** — spec defaults to the system UI stack (no network font, strict CSP). If A4 wants Inter, self-host via `@fontsource/inter` (dependency decision for A0). *Recommendation: system stack for v1.*
2. **Notifications bell (FR-025)** — AppShell header from W4 or added in W5? *Recommendation: reserve the slot now (empty bell + count), implement in W5.*
3. **FocusIndicator on public routes** — FR-009 says "every route"; this spec shows it on authenticated routes + `/403`/`/404` only. *Recommendation: keep it off `/`, `/login`, `/signup`; confirm with A0/A1.*
4. **`StartFocusCard` when no agent** — disabled button + inline reason + §6.4 card, or enabled and click opens the card? *Recommendation: disabled + reason + card (no dead-end click).*
5. **`/settings` scope** — acceptable to omit account deletion and the start-at-login toggle from the dashboard (agent-owned, REC-008) in v1? *Recommendation: yes; document in README limitations.*
