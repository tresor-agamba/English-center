---
name: Academic Vision
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#44474e'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#74777f'
  outline-variant: '#c4c6d0'
  surface-tint: '#485e8a'
  primary: '#021f48'
  on-primary: '#ffffff'
  primary-container: '#1d355e'
  on-primary-container: '#889ece'
  inverse-primary: '#b0c7f8'
  secondary: '#006a60'
  on-secondary: '#ffffff'
  secondary-container: '#8cf5e4'
  on-secondary-container: '#007166'
  tertiary: '#450900'
  on-tertiary: '#ffffff'
  tertiary-container: '#6b1400'
  on-tertiary-container: '#f67a5b'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d7e2ff'
  primary-fixed-dim: '#b0c7f8'
  on-primary-fixed: '#001a40'
  on-primary-fixed-variant: '#304670'
  secondary-fixed: '#8cf5e4'
  secondary-fixed-dim: '#6fd8c8'
  on-secondary-fixed: '#00201c'
  on-secondary-fixed-variant: '#005048'
  tertiary-fixed: '#ffdad2'
  tertiary-fixed-dim: '#ffb4a2'
  on-tertiary-fixed: '#3c0700'
  on-tertiary-fixed-variant: '#83260e'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: manrope
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: manrope
    fontSize: 32px
    fontWeight: '800'
    lineHeight: 40px
  headline-lg:
    fontFamily: manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-md:
    fontFamily: manrope
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  body-lg:
    fontFamily: inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  section-padding-desktop: 80px
  section-padding-mobile: 40px
  gutter: 24px
  margin-desktop: auto
  max-width: 1280px
---

## Brand & Style
The design system for the public pages is built on a foundation of professional excellence and academic aspiration. It targets students and professionals seeking language mastery and skill development. The visual narrative balances the authority of a traditional institution with the accessibility of a modern, digital-first academy.

The style is **Corporate / Modern** with a focus on high legibility and structured information density. It employs a "Soft-Professional" aesthetic—using generous white space to reduce cognitive load while maintaining a rigorous grid to instill trust. The emotional response should be one of confidence, clarity, and progress.

## Colors
The palette is derived from the official identity to ensure brand recognition and accessibility.

*   **Primary (Navy):** Used for headers, footers, and primary navigational elements to ground the UI in authority.
*   **Secondary (Teal):** Used for supportive brand accents, icons, and subtle highlights.
*   **Tertiary (Warm Orange):** Reserved strictly for high-priority calls to action (CTAs) and urgent indicators to ensure they stand out against the cool primary palette.
*   **Neutral:** A range of light, warm grays and off-whites are used for section backgrounds and surface containers to provide a soft contrast to the dark navy text.

## Typography
The system uses a pairing of **Manrope** for headlines and **Inter** for body text. Manrope’s geometric yet friendly nature provides a modern "visionary" feel for titles, while Inter ensures maximum readability for instructional content.

Large display sizes should use a tighter letter spacing to maintain visual cohesion. Labels and small metadata should use semi-bold weights and slight tracking to remain legible at small scales.

## Layout & Spacing
The layout follows a **Fixed Grid** model on desktop, centered within the viewport with a maximum width of 1280px. This ensures a consistent reading experience on ultra-wide monitors.

*   **Grid:** 12-column layout for desktop, 4-column for mobile.
*   **Rhythm:** An 8px linear scale governs all padding and margins.
*   **Transitions:** On mobile, page margins shrink to 20px, and section vertical padding is halved to keep content momentum.
*   **Alignment:** Text-heavy educational content should be left-aligned to improve scanning speed, while Hero sections may utilize centered compositions for impact.

## Elevation & Depth
Depth is communicated through **Tonal Layers** and extremely soft **Ambient Shadows**.

*   **Level 0 (Background):** Neutral light gray (#F8FAFC) used for the main canvas.
*   **Level 1 (Cards):** Pure white (#FFFFFF) surfaces with a subtle 1px border (#E2E8F0).
*   **Level 2 (Interactive):** When hovered, cards should lift using an extra-diffused shadow (0px 10px 25px rgba(29, 53, 94, 0.05)) to suggest interactivity.
*   **Level 3 (Overlays):** Modals and dropdowns use a slightly more pronounced shadow to separate from the content stack.

## Shapes
The shape language is defined by a **16px (1rem) corner radius** for primary containers and cards, as seen in the academy's core UI. This "Rounded" approach softens the corporate navy, making the platform feel more welcoming to students.

*   **Buttons:** Use a 8px radius for a more precise, "action-oriented" look.
*   **Form Inputs:** Match the 8px radius of buttons for consistent alignment in input groups.
*   **Images:** Apply the full 16px radius to all featured imagery to integrate with the card system.

## Components
### Buttons
*   **Primary:** Solid Navy with white text.
*   **Secondary:** Solid Teal with white text for "Success" or "Support" actions.
*   **Action/CTA:** Solid Warm Orange for "Sign Up" or "Enroll Now" to ensure immediate visibility.

### Cards
Cards are the primary organizational unit. They must feature a 16px border radius, a white background, and a subtle 1px neutral border. Padding inside cards should be a minimum of 24px (3 units of 8px).

### Input Fields
Inputs should have a light background, 8px radius, and a 1px border that shifts to Primary Navy on focus. Labels should sit above the field in `label-md` typography.

### Lists & Navigation
Navigation links in the header use Navy text with a Teal underline on hover. The footer uses the Navy background with white text and light-opacity teal accents for category headers.

### Chips/Tags
Used for course categories or status (e.g., "6 months"). These should use a light teal background with dark teal text and a pill-shaped radius.