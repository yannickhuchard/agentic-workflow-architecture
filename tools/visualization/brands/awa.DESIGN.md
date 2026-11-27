---
version: alpha
name: AWA
description: The look of AWA's views of journeys, runs and measures, dark by default, with a light mode.
colors:
  primary: "#818CF8"
  on-primary: "#FFFFFF"
  dark:
    surface: "#0B0F19"
    on-surface: "#F8FAFC"
    on-surface-variant: "#CBD5E1"
    surface-container-low: "#111827"
    surface-container: "#1E293B"
    surface-container-high: "#2A3A52"
    outline: "#475569"
  light:
    primary: "#4F46E5"
    surface: "#F5F6F8"
    on-surface: "#0F172A"
    on-surface-variant: "#334155"
    surface-container-low: "#FFFFFF"
    surface-container: "#FFFFFF"
    surface-container-high: "#E8EBF0"
    outline: "#94A3B8"
typography:
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.2
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 600
    letterSpacing: 0.06em
rounded:
  md: 8px
  lg: 12px
spacing:
  gutter: 16px
  margin: 28px
---

# AWA

These are the tokens of AWA's own views (`tools/visualization`): the journey view, the replay and the measures page. The views draw with them when no brand is given, and fill any token a company's DESIGN.md leaves out with them.

## Overview

A calm, dark stage that lets the state of the work stand out. A reader follows one moment at a time: the step being read is lit, what came before is done, what comes after waits. Colour never carries meaning alone: every state also has a shape, a line style or a word.

## Colors

- **Primary (#818CF8 dark, #4F46E5 light):** indigo, for what a reader acts on and where they are: buttons, focus, the step and the stage in view, bars. The light mode takes a deeper indigo, so that it reads on a light page.
- **Surface (#0B0F19 dark, #F5F6F8 light):** the page. Panels and cards sit one step lighter in the dark mode, white in the light mode.
- **On-surface (#F8FAFC dark, #0F172A light):** text, and at low opacity the lines between things.

The colours of states are not brand tokens. Running (#A855F7), waiting (#FBBF24), done (#10B981), failed (#FF4D4F) and undone (#9CA3AF) keep their hue whatever the brand, so that they keep their meaning; the views adjust their lightness to the background so that a word reads at 4.5:1 and a mark at 3:1.

## Typography

Space Grotesk for titles and large numbers, Inter for everything else. Names of steps are 12 px semibold and never drawn below 11 px.

## Shapes

Boxes and buttons have 8 px corners, panels and cards 12 px.

## Do's and Don'ts

- Do keep the colours of states for states only.
- Do show a word or a shape beside every colour that means something.
- Don't draw a step's name below 11 px; show less of the diagram instead.
