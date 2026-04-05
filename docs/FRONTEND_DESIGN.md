# wayfr — Frontend Design System

## Design Philosophy

**"Invisible intelligence made visible."**

wayfr helps blind users navigate invisibly (via audio). The web frontend is the face
of the product for caregivers, judges, and investors. It must communicate:
- **Trust:** Clean, precise, professional
- **Impact:** The mission is accessible immediately
- **Depth:** Technical sophistication visible through data visualization
- **Accessibility:** Ironic if an accessibility product's own UI is inaccessible

---

## Design Tokens

### Color System

```css
/* Light mode */
--background: 0 0% 100%          /* Pure white */
--foreground: 224 71.4% 4.1%     /* Near black */
--card: 0 0% 100%
--card-foreground: 224 71.4% 4.1%
--primary: 220 90% 56%           /* Electric blue — technology, trust */
--primary-foreground: 0 0% 100%
--secondary: 220 14.3% 95.9%
--muted: 220 14.3% 95.9%
--muted-foreground: 220 8.9% 46.1%
--accent: 142 76% 36%            /* Green — verified, safe */
--destructive: 0 84.2% 60.2%     /* Red — urgent hazards */
--border: 220 13% 91%
--ring: 220 90% 56%

/* Dark mode */
--background: 224 71.4% 4.1%
--foreground: 210 20% 98%
--card: 224 71.4% 7%
--primary: 220 90% 65%
--accent: 142 76% 45%
--muted: 215 27.9% 16.9%
--muted-foreground: 217.9 10.6% 64.9%
--border: 215 27.9% 16.9%
```

### Typography

```css
--font-sans: "Inter", system-ui, sans-serif;    /* Body, UI */
--font-mono: "JetBrains Mono", monospace;        /* Code, data, coordinates */

/* Scale */
--text-xs:   0.75rem / 1rem
--text-sm:   0.875rem / 1.25rem
--text-base: 1rem / 1.5rem
--text-lg:   1.125rem / 1.75rem
--text-xl:   1.25rem / 1.75rem
--text-2xl:  1.5rem / 2rem
--text-3xl:  1.875rem / 2.25rem
--text-4xl:  2.25rem / 2.5rem
--text-5xl:  3rem / 1
--text-6xl:  3.75rem / 1
```

### Spacing & Radius

```css
--radius: 0.625rem     /* 10px — rounded but not bubbly */
--radius-sm: 0.375rem
--radius-lg: 0.75rem
--radius-xl: 1rem
--radius-full: 9999px
```

---

## shadcn/ui Components Used

Install all at once: `pnpm dlx shadcn@latest add <component>`

| Component | Pages Used | Notes |
|-----------|-----------|-------|
| `button` | All pages | Primary CTA, verify button |
| `card` | Dashboard, Map | Session card, hazard card |
| `badge` | Dashboard | Severity badges, verified badge |
| `avatar` | Dashboard | User profile |
| `dialog` | Report, Verify | World ID modal, hazard submit |
| `sheet` | Mobile nav | Slide-out menu |
| `tabs` | Dashboard | Detections / Hazards / Map tabs |
| `separator` | All | Layout dividers |
| `skeleton` | Dashboard | Loading states for real-time data |
| `toast` | All | Success/error notifications |
| `tooltip` | Map | Hazard marker tooltips |
| `dropdown-menu` | Nav | User menu |
| `switch` | Settings | Voice commands, face recognition toggle |
| `slider` | Settings | Narration speed |
| `progress` | Dashboard | Session duration bar |
| `chart` | Dashboard | Detection frequency sparkline |
| `input` | Report | Hazard description |
| `textarea` | Report | Notes field |
| `select` | Report | Hazard type selector |
| `form` | Report | React Hook Form + Zod validation |
| `alert` | Dashboard | Active hazard warning banner |
| `scroll-area` | Dashboard | Detection history |
| `command` | Map | Location search |

---

## Magic UI Components Used

Source: magicui.design — install individually via CLI

```bash
# Install each as needed
pnpm dlx magicui-cli add <component>
```

| Component | Location | Effect |
|-----------|---------|--------|
| `animated-beam` | Landing, Architecture | Animated lines showing data flow: glasses → AI → audio |
| `globe` | Landing hero | Rotating globe with location dots (user locations) |
| `number-ticker` | Landing stats | Animated count-up: "253,000,000 people affected" |
| `shimmer-button` | Landing CTA | Shimmering "Get Started" button |
| `border-beam` | Session card | Animated border when session is active |
| `sparkles-text` | Landing title | "See the World" with sparkle effect |
| `blur-fade` | Page transitions | Content fades in on route change |
| `bento-grid` | Landing features | Feature cards in bento layout |
| `particles` | World ID modal | Particle effect on successful verification |
| `animated-list` | Detection feed | Staggered list animation for new detections |
| `marquee` | Landing social proof | Scrolling: "Used in 12 countries", "4.9★ rating" |
| `pulsating-button` | Active session | Pulse animation on "Session Active" indicator |
| `retro-grid` | Landing background | Subtle grid background |
| `meteors` | Hero section | Falling meteor effect behind hero text |
| `dot-pattern` | Various | Subtle dot texture backgrounds |
| `grid-pattern` | Settings bg | Grid pattern background |

---

## Page Layouts

### `/` — Landing Page

```
┌──────────────────────────────────────────────────────────┐
│  Nav: wayfr logo | Features | Map | [Get Started]   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  [Meteors background]  [RetroGrid]                       │
│                                                          │
│  ✨ SparklesText: "See the World"                        │
│  Subtext: "AI navigation for the visually impaired"      │
│                                                          │
│  [ShimmerButton: Get Started]  [Button: Watch Demo]      │
│                                                          │
│  NumberTicker: "253,000,000+ people with visual          │
│  impairment. Zero AI-powered wearable guides."           │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  AnimatedBeam section: How it works                      │
│                                                          │
│  [Ray-Ban icon] ──beam──▶ [AI Cloud icon] ──beam──▶      │
│                    ▲                            │        │
│  [Community icon]──┘                            ▼        │
│                                       [Speaker icon]     │
│                                                          │
│  "Glasses capture. AI processes. You hear."              │
├──────────────────────────────────────────────────────────┤
│  BentoGrid: Features                                     │
│  ┌────────────┬─────────────────┐                        │
│  │ Obstacle   │ Community       │                        │
│  │ Detection  │ Hazard Map      │                        │
│  │ Real-time  │ World ID        │                        │
│  ├────────────┴─────────────────┤                        │
│  │ Text Reading │ Caregiver     │                        │
│  │ OCR in 150ms │ Dashboard     │                        │
│  └─────────────┴────────────────┘                        │
├──────────────────────────────────────────────────────────┤
│  Globe section:                                          │
│  "Trusted in cities worldwide"                           │
│  [Interactive globe with pins showing active users]      │
├──────────────────────────────────────────────────────────┤
│  Marquee: testimonials / stats                           │
├──────────────────────────────────────────────────────────┤
│  Footer: GitHub | World ID badge | Powered by Gemini     │
└──────────────────────────────────────────────────────────┘
```

### `/dashboard` — Caregiver Dashboard

```
┌──────────────────────────────────────────────────────────┐
│  Nav + dark/light toggle                                 │
├──────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐ ┌──────────────────────────┐   │
│  │ Session Card          │ │ Nearby Hazards          │   │
│  │ [BorderBeam active]   │ │                         │   │
│  │ 🟢 Alex — Active      │ │ ⚠ 2 active hazards     │   │
│  │ Walking 2.1 mph       │ │ Construction (32m ahead)│   │
│  │ Last seen: 2s ago     │ │ Wet floor (67m left)   │   │
│  │ [PulsatingButton]     │ └──────────────────────────┘   │
│  └──────────────────────┘                                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Live Map (Mapbox)                                │    │
│  │ • Blue dot: Alex's real-time location             │    │
│  │ • Red markers: Hazards (size = severity)          │    │
│  │ • Orange area: Alex's traversed path today        │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Detection Feed (AnimatedList + ScrollArea)       │    │
│  │ 10:32:01  Curb detected 2ft ahead (urgent)      │    │
│  │ 10:32:04  Sign: "PUSH" read aloud                │    │
│  │ 10:32:07  Clear path, continuing forward         │    │
│  │ [Skeleton loaders for incoming data]             │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  [Send Message to Alex] → opens Dialog with text input  │
└──────────────────────────────────────────────────────────┘
```

### `/map` — Community Hazard Map

```
┌──────────────────────────────────────────────────────────┐
│  Full-screen Mapbox GL JS (3D buildings enabled)         │
│                                                          │
│  Controls overlay (top-right):                           │
│  • Filter: [All] [Construction] [Wet Floor] [Steps]     │
│  • Show only verified ToggleSwitch                       │
│  • [+ Report Hazard] ShimmerButton                      │
│                                                          │
│  Map markers:                                            │
│  • Circle markers, colored by severity:                  │
│    - critical: #ef4444 (red), radius 20px               │
│    - high: #f97316 (orange), radius 16px                │
│    - medium: #eab308 (yellow), radius 12px              │
│    - low: #22c55e (green), radius 8px                   │
│  • Verified badge: small ✓ overlay on marker            │
│  • Cluster at zoom < 14                                  │
│                                                          │
│  Click marker → Tooltip:                                 │
│  ┌────────────────────────────────┐                      │
│  │ ⚠ Construction Zone           │                      │
│  │ Verified by 4 people          │                      │
│  │ "Entire block torn up"        │                      │
│  │ Reported 2h ago               │                      │
│  │ [Mark Resolved]               │                      │
│  └────────────────────────────────┘                      │
└──────────────────────────────────────────────────────────┘
```

### `/verify` + `/report` — World ID Flow

```
Step 1: /verify
┌──────────────────────────────────────────────────────────┐
│  [Particles background on success]                       │
│                                                          │
│  "Verify you're human to submit trusted hazard reports"  │
│                                                          │
│  [World ID Logo]                                         │
│                                                          │
│  "wayfr uses World ID to ensure every hazard report  │
│  comes from a real person. Blind users depend on this    │
│  data for their safety."                                 │
│                                                          │
│  [ShimmerButton: Verify with World ID]                   │
│                                                          │
│  Already verified? Skip →                               │
└──────────────────────────────────────────────────────────┘

Step 2: /report (after verification)
┌──────────────────────────────────────────────────────────┐
│  ✅ Verified Human                                       │
│  3 reports remaining today                               │
│                                                          │
│  [Map with pin drop or GPS auto-locate]                  │
│                                                          │
│  Form:                                                   │
│  Hazard Type: [Select]                                   │
│  Severity: [Low] [Medium] [High] [Critical]              │
│  Photo: [Upload or take]                                 │
│  Notes: [Textarea]                                       │
│                                                          │
│  [Submit Report]                                         │
│                                                          │
│  "Your report will be reviewed by our community.         │
│  3+ verified reports = automatically verified."          │
└──────────────────────────────────────────────────────────┘
```

---

## Animation Specifications

| Animation | Duration | Easing | Trigger |
|-----------|---------|--------|---------|
| Page transition (BlurFade) | 400ms | ease-out | Route change |
| NumberTicker | 1500ms | ease-out | Viewport entry |
| AnimatedBeam | 3000ms loop | linear | Always |
| Globe rotation | Continuous | linear | Always |
| BorderBeam (active session) | 2500ms loop | linear | Session active |
| PulsatingButton | 1500ms loop | ease-in-out | Session active |
| AnimatedList item | 200ms | spring | New detection |
| Particles (verify success) | 1000ms | ease-out | On verification |
| Skeleton shimmer | 1500ms loop | ease-in-out | Loading state |
| Marker pulse (urgent) | 800ms loop | ease-in-out | Urgent hazard |

---

## Responsive Breakpoints

```
sm:  640px  — Mobile landscape
md:  768px  — Tablet portrait
lg:  1024px — Tablet landscape / small laptop
xl:  1280px — Desktop
2xl: 1536px — Wide desktop
```

Dashboard layout:
- Mobile: Stacked (session card → map → feed)
- Desktop: Two-column (map 60% | cards + feed 40%)

---

## Accessibility Requirements

Since this is an accessibility product, the UI must meet WCAG 2.1 AA:

- All interactive elements: keyboard accessible (Tab, Enter, Space)
- All images: descriptive `alt` text
- Color contrast: ≥ 4.5:1 for text, ≥ 3:1 for UI elements
- Focus indicators: visible and distinct (2px ring using `--ring` token)
- Screen reader: all live regions (`aria-live="polite"` for detection feed)
- Motion: `prefers-reduced-motion` respected (disable all animations)
- Hazard severity: never communicated by color alone (also use icons + text labels)

---

## Dark/Light Theme Implementation

```tsx
// apps/web/app/layout.tsx
import { ThemeProvider } from "next-themes"

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
```

```tsx
// Theme toggle component (in nav)
import { useTheme } from "next-themes"
import { Sun, Moon } from "lucide-react"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
```
