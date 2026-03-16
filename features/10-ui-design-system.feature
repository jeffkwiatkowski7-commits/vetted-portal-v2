@ui @design-system @vetted-branding
Feature: UI Design System and Layout Specifications
  As a developer building the Vetted Portal
  I want a comprehensive design system based on the Vetted brand
  So that all components are visually consistent with the Vetted look and feel

  Background:
    Given the portal follows the Vetted brand identity
    And the design system is applied consistently across all pages

  # ---------- Color Palette ----------

  Scenario: Vetted color palette is applied throughout the portal
    Then the following colors should be used consistently:
      | Token                  | Hex       | Usage                                        |
      | --color-primary        | #1A1A1A   | Primary buttons, headings, body text         |
      | --color-accent         | #C4A962   | Accent highlights, active states, icons      |
      | --color-background     | #FFFFFF   | Page backgrounds, card backgrounds           |
      | --color-surface        | #F9FAFB   | Subtle section backgrounds, hover states     |
      | --color-border         | #E5E7EB   | Card borders, dividers, input borders        |
      | --color-text-primary   | #1A1A1A   | Headings, primary text                       |
      | --color-text-secondary | #6B7280   | Descriptions, timestamps, helper text        |
      | --color-text-muted     | #9CA3AF   | Placeholders, disabled text                  |
      | --color-success        | #10B981   | Success states, completed indicators         |
      | --color-warning        | #F59E0B   | Warning states, degraded health              |
      | --color-danger         | #EF4444   | Error states, delete actions, failed steps   |
      | --color-info           | #3B82F6   | Informational badges, links                  |

  # ---------- Typography ----------

  Scenario: Vetted typography hierarchy is applied
    Then the following typography rules should be used:
      | Element            | Font Family          | Weight | Size    | Line Height |
      | H1 (Page Titles)   | Serif (e.g., Playfair Display or similar) | Bold   | 32px   | 1.2  |
      | H2 (Section Heads) | Serif                | SemiBold | 24px | 1.3        |
      | H3 (Card Titles)   | Serif                | SemiBold | 18px | 1.4        |
      | Body               | Sans-serif (e.g., Inter or similar) | Regular | 16px | 1.5 |
      | Body Small         | Sans-serif           | Regular | 14px   | 1.5        |
      | Caption            | Sans-serif           | Regular | 12px   | 1.4        |
      | Code               | Monospace (e.g., JetBrains Mono) | Regular | 14px | 1.6 |
      | Logo "Vetted."     | Serif                | Bold   | 24px   | 1.0        |
    And the "Vetted." logo should always include the period
    And headings should use the serif font to match vetted.com's editorial aesthetic

  # ---------- Spacing System ----------

  Scenario: Consistent spacing is applied
    Then the spacing scale should follow:
      | Token    | Value | Usage                                    |
      | --sp-xs  | 4px   | Tight spacing within compact elements    |
      | --sp-sm  | 8px   | Icon-to-text gaps, small padding         |
      | --sp-md  | 16px  | Standard padding, card internal spacing  |
      | --sp-lg  | 24px  | Section spacing, card margins            |
      | --sp-xl  | 32px  | Page section gaps                        |
      | --sp-2xl | 48px  | Major layout sections                    |
      | --sp-3xl | 64px  | Page top/bottom margins                  |
    And the overall feel should be spacious and uncluttered (matching Vetted's generous whitespace)

  # ---------- Buttons ----------

  Scenario: Primary button styling
    Then primary buttons should be styled as:
      | Property          | Value                                  |
      | Background        | #1A1A1A (black)                        |
      | Text Color        | #FFFFFF (white)                        |
      | Border Radius     | 8px (rounded)                          |
      | Padding           | 12px 24px                              |
      | Font              | Sans-serif, 14px, SemiBold             |
      | Hover             | Slight opacity reduction or #333333    |
      | Active            | Scale 0.98                             |
      | Disabled          | #D1D5DB background, #9CA3AF text       |
    And examples include: "Start a Conversation", "Create", "Save Changes"

  Scenario: Secondary button styling
    Then secondary buttons should be styled as:
      | Property          | Value                                  |
      | Background        | #FFFFFF (white)                        |
      | Text Color        | #1A1A1A (black)                        |
      | Border            | 1px solid #1A1A1A                      |
      | Border Radius     | 8px (rounded)                          |
      | Padding           | 12px 24px                              |
      | Hover             | Light gray background (#F9FAFB)        |
    And examples include: "Our Services", "Cancel", "Clear Filters"

  Scenario: Danger button styling
    Then danger/destructive buttons should be styled as:
      | Property          | Value                                  |
      | Background        | #EF4444 (red)                          |
      | Text Color        | #FFFFFF (white)                        |
      | Border Radius     | 8px                                    |
      | Hover             | #DC2626 (darker red)                   |
    And examples include: "Delete", "Remove", "Revoke"

  # ---------- Cards ----------

  Scenario: Standard card component styling
    Then cards should be styled as:
      | Property          | Value                                  |
      | Background        | #FFFFFF                                |
      | Border            | 1px solid #E5E7EB                      |
      | Border Radius     | 12px                                   |
      | Padding           | 24px                                   |
      | Shadow (default)  | None or very subtle                    |
      | Shadow (hover)    | 0 4px 12px rgba(0,0,0,0.08)           |
      | Transition        | box-shadow 0.2s ease                   |
    And cards are used for: project cards, app cards, stat cards, resource cards

  # ---------- Form Inputs ----------

  Scenario: Input field styling
    Then text inputs should be styled as:
      | Property          | Value                                  |
      | Background        | #FFFFFF                                |
      | Border            | 1px solid #E5E7EB                      |
      | Border Radius     | 8px                                    |
      | Padding           | 12px 16px                              |
      | Font              | Sans-serif, 14px                       |
      | Placeholder Color | #9CA3AF                                |
      | Focus Border      | #C4A962 (gold/amber accent)            |
      | Focus Ring        | 0 0 0 3px rgba(196, 169, 98, 0.2)     |
      | Error Border      | #EF4444                                |
      | Error Message     | #EF4444, 12px, below the input         |

  # ---------- Sidebar Layout ----------

  Scenario: Sidebar dimensions and styling
    Then the sidebar should follow these specifications:
      | Property              | Value                                  |
      | Width (expanded)      | 280px                                  |
      | Width (collapsed)     | 64px                                   |
      | Background            | #FFFFFF                                |
      | Border Right          | 1px solid #E5E7EB                      |
      | Logo Area Height      | 64px                                   |
      | Nav Item Height       | 44px                                   |
      | Nav Item Padding      | 12px 16px                              |
      | Active Nav Background | #F9FAFB                                |
      | Active Nav Left Border| 3px solid #C4A962                      |
      | Hover Background      | #F9FAFB                                |
      | Section Dividers      | 1px solid #F3F4F6 with 16px margin     |

  # ---------- Main Content Area ----------

  Scenario: Main content area layout
    Then the main content area should follow:
      | Property              | Value                                  |
      | Background            | #FFFFFF                                |
      | Max Content Width     | 800px (centered for chat views)        |
      | Full Width Views      | Projects, Library, Admin (no max-width)|
      | Padding               | 32px horizontal, 24px vertical         |
      | Scroll                | Vertical scroll, hidden scrollbar      |

  # ---------- Chat Message Bubbles ----------

  Scenario: Chat message styling
    Then chat messages should be styled as:
      | Element                | Style                                  |
      | User Message Bg        | #F3F4F6 (light gray)                  |
      | User Message Align     | Right-aligned                          |
      | User Message Radius    | 16px 16px 4px 16px                    |
      | AI Response Bg         | #FFFFFF (white, no background)        |
      | AI Response Align      | Left-aligned                           |
      | AI Response Border     | None (clean, open layout)             |
      | Message Padding        | 16px                                   |
      | Message Spacing        | 16px between messages                 |
      | Avatar Size            | 32px circle                            |
      | Timestamp              | 12px, #9CA3AF, below message          |

  # ---------- Responsive Behavior ----------

  Scenario: Desktop layout (1440px+)
    Given the viewport width is 1440px or greater
    Then the sidebar should be expanded by default
    And the main content should center within available space
    And all grid layouts should use appropriate column counts

  Scenario: Tablet layout (768px - 1439px)
    Given the viewport width is between 768px and 1439px
    Then the sidebar should be collapsible (default collapsed)
    And card grids should reduce to 2 columns
    And the chat input should remain fixed at the bottom

  Scenario: Mobile layout (below 768px)
    Given the viewport width is below 768px
    Then the sidebar should be hidden behind a hamburger menu
    And all layouts should be single-column
    And the chat input should remain accessible at the bottom

  # ---------- Animations and Transitions ----------

  Scenario: UI animations follow Vetted's polished feel
    Then the following animations should be used:
      | Element                | Animation                              |
      | Page transitions       | Fade in, 200ms ease                   |
      | Card hover             | Shadow elevation, 200ms ease          |
      | Sidebar collapse       | Width transition, 300ms ease-in-out   |
      | Button press           | Scale 0.98, 100ms                     |
      | Toast notifications    | Slide in from top-right, 300ms       |
      | Modal open             | Fade + scale from 0.95, 200ms        |
      | Progress bar steps     | Gold pulse animation, 1s loop         |
      | Streaming text         | Cursor blink, smooth append           |

  # ---------- Accessibility ----------

  Scenario: Portal meets accessibility standards
    Then the portal should meet WCAG 2.1 AA compliance:
      | Requirement                | Description                           |
      | Color Contrast             | All text meets 4.5:1 minimum ratio   |
      | Keyboard Navigation        | All interactive elements focusable   |
      | Focus Indicators           | Visible focus rings on all elements  |
      | Screen Reader Support      | Proper ARIA labels and roles         |
      | Alt Text                   | All images have descriptive alt text |
      | Reduced Motion             | Respect prefers-reduced-motion       |
