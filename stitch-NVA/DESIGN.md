---
name: Premium Scholastic SaaS
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45464d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#2a1700'
  on-tertiary-container: '#b87500'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: '1.2'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 0.5rem
  sm: 1rem
  md: 1.5rem
  lg: 2.5rem
  xl: 4rem
  gutter: 24px
  margin: 32px
  max_width: 1280px
---

## Brand & Style
The design system is engineered to elevate the educational experience from a standard learning platform to a premium, SaaS-oriented academy. The brand personality is **authoritative, innovative, and sophisticated**. It targets professional learners and ambitious students who value clarity and efficiency.

The visual style is a blend of **Minimalism** and **Modern Corporate** aesthetics. It utilizes generous whitespace (macro-typography) to reduce cognitive load and focuses on a high-contrast interface that ensures accessibility while maintaining a "tech-forward" feel. The interface avoids rounded, "bubbly" elements in favor of more structured, precise shapes that signal professional rigor.

## Colors
The palette is derived directly from the core logo assets, refined for digital accessibility.
- **Primary (Navy Blue):** Used for deep backgrounds, primary navigation, and high-level headings. It provides the "anchor" for the premium aesthetic.
- **Secondary (Teal):** Used for accent details, success states, and progress indicators. It represents growth and modern technology.
- **Tertiary (Amber/Orange):** Reserved exclusively for high-priority Call-to-Action (CTA) buttons to maximize conversion contrast against the navy and white.
- **Neutral (Slate):** A range of cool grays used for body text, borders, and secondary metadata to maintain a clean, professional tone.

## Typography
The system employs two distinct sans-serif families to create a tiered information hierarchy. **Plus Jakarta Sans** is used for headings to provide a modern, slightly geometric personality that feels fresh and approachable. **Hanken Grotesk** is utilized for all functional body text and labels due to its exceptional legibility and technical precision. 

To ensure a premium feel, paragraph widths should be limited to 65-75 characters, and line heights are intentionally kept airy (1.5 - 1.6x) to facilitate scanning of educational content.

## Layout & Spacing
The layout follows a **Fluid Grid** model with a 12-column structure for desktop and a 4-column structure for mobile. 
- **Desktop (1280px+):** Elements span defined column counts with 24px gutters.
- **Tablet (768px - 1279px):** Margins reduce to 24px, and card layouts typically stack or reduce to 2 columns.
- **Mobile (<767px):** Margins reduce to 16px. All major CTAs become full-width.

Spacing is strictly based on a **4px baseline grid**. Macro-spacing (48px, 64px, 80px) is used between major sections to define a "breathe-able" SaaS experience.

## Elevation & Depth
Depth is created through **Tonal layering** and **Ambient shadows** rather than heavy borders.
- **Surface Level 0:** The main background (#FFFFFF).
- **Surface Level 1 (Cards):** Slightly elevated using a very soft, diffused shadow (0px 4px 20px rgba(15, 23, 42, 0.05)) to separate content from the background.
- **Interactive States:** On hover, cards should increase in elevation with a slightly deeper shadow and a subtle Y-axis translation (-4px) to indicate interactivity.
- **Navigation:** Top navigation bars use a backdrop-blur (Glassmorphism) with 90% opacity to maintain context while scrolling through content.

## Shapes
The design system utilizes a **Rounded** (Level 2) shape language. This provides a balance between the friendliness of education and the precision of a SaaS platform.
- **Buttons & Inputs:** 0.5rem (8px) corner radius.
- **Cards & Containers:** 1rem (16px) corner radius.
- **Chips/Badges:** 2rem (32px) for a full-pill shape to distinguish them from interactive buttons.

## Components
- **Primary Buttons:** High-contrast Amber (#F59E0B) with white text for main CTAs. Bold weight, uppercase.
- **Secondary Buttons:** Navy Blue outline or solid Navy with white text for administrative actions.
- **Cards:** White backgrounds with subtle 1px border (#E2E8F0) and the Level 1 shadow defined in the Elevation section. Card headers should use Headline-SM.
- **Inputs:** Minimalist style with a 1px Slate border. On focus, the border transitions to Teal (#0D9488) with a soft outer glow.
- **Progress Indicators:** Use the Teal accent color to represent completion or active learning states.
- **Navigation:** Deep Navy for the footer and transparent-to-white blur for the header to maintain a "clean" entry point.
- **Accordions (FAQs):** Flush cards with soft dividers, using plus/minus icons in Teal to guide user interaction.