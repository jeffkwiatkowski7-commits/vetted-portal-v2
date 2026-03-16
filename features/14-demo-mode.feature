@demo @walkthrough @demonstration
Feature: Demo Mode - Guided Portal Walkthrough
  As a Vetted Portal demonstrator
  I want an automated walkthrough that showcases all portal features
  So that I can present the portal's capabilities to stakeholders without manual navigation

  Background:
    Given the Vetted Portal is loaded
    And demo mode is available to all users

  # ---------- Play Demo Button ----------

  Scenario: Play Demo button is visible in the upper left
    Then a "Play Demo" button should be displayed in the upper-left corner of the portal:
      | Property          | Value                                          |
      | Position          | Fixed, upper-left, above or beside the logo    |
      | Icon              | Play triangle (▶) icon                         |
      | Label             | "Play Demo"                                    |
      | Background        | Gold/amber (#C4A962)                           |
      | Text Color        | White (#FFFFFF)                                |
      | Border Radius     | 8px                                            |
      | Z-Index           | Topmost layer (above all content)              |
      | Hover             | Slightly darker gold with subtle shadow        |
    And the button should be visible on all pages of the portal
    And it should not obstruct the sidebar navigation

  Scenario: Play Demo button click starts the walkthrough
    When I click the "Play Demo" button
    Then the demo walkthrough should begin
    And the button should transform into a demo control bar:
      | Element            | Description                                    |
      | Pause Button       | ⏸ Pause icon to pause the walkthrough          |
      | Play Button        | ▶ Play icon (shown when paused)                |
      | Step Counter       | "Step 3 of 24" showing current progress        |
      | Step Title         | Current step name (e.g., "Chat Interface")     |
      | Progress Bar       | Thin gold bar showing overall demo progress    |
      | Skip Button        | ⏭ Skip to next step                            |
      | Exit Button        | ✕ Close/exit demo mode                         |
    And the control bar should be fixed to the upper-left area
    And it should have a clean white background with subtle shadow

  # ---------- Demo Control Bar ----------

  Scenario: Pause the demo walkthrough
    Given the demo is actively playing
    When I click the Pause button (⏸)
    Then the walkthrough should pause at the current step
    And the Pause button should change to a Play button (▶)
    And the current highlight/spotlight should remain visible
    And a tooltip overlay should remain readable
    And the step counter should stop advancing

  Scenario: Resume the demo after pausing
    Given the demo is paused
    When I click the Play button (▶)
    Then the walkthrough should resume from where it paused
    And the Play button should change back to Pause (⏸)
    And the step transitions should continue

  Scenario: Skip to the next demo step
    Given the demo is playing or paused
    When I click the Skip button (⏭)
    Then the walkthrough should advance to the next step immediately
    And the step counter should update
    And the appropriate navigation/animation should occur

  Scenario: Exit demo mode
    Given the demo is playing or paused
    When I click the Exit button (✕)
    Then a confirmation dialog should appear:
      | Element     | Content                              |
      | Title       | "Exit Demo?"                         |
      | Message     | "End the walkthrough and return to the portal?" |
      | Continue    | "Keep Watching" (primary button)     |
      | Exit        | "Exit Demo" (secondary button)       |
    When I confirm exit
    Then the demo should stop completely
    And all spotlights and overlays should be removed
    And the portal should return to normal interactive state
    And the "Play Demo" button should reappear in the upper left

  # ---------- Demo Spotlight & Overlay System ----------

  Scenario: Spotlight highlights the active UI element
    Given the demo is playing a step
    Then the current feature area should be highlighted with a spotlight:
      | Property             | Value                                     |
      | Spotlight Shape      | Rounded rectangle around target element   |
      | Background Overlay   | Semi-transparent dark (#00000080)         |
      | Spotlight Border     | 2px solid gold/amber (#C4A962)            |
      | Spotlight Glow       | Subtle gold box-shadow pulse              |
      | Tooltip Position     | Adjacent to spotlight (auto-positioned)   |
    And areas outside the spotlight should be dimmed
    And the spotlight should smoothly animate between steps

  Scenario: Tooltip displays step description
    Given a feature is spotlighted during the demo
    Then a tooltip card should appear near the spotlight:
      | Element            | Style                                      |
      | Background         | White (#FFFFFF)                            |
      | Border             | 1px solid #E5E7EB                          |
      | Border Radius      | 12px                                       |
      | Shadow             | Subtle drop shadow                         |
      | Title              | Step name in Vetted serif font, bold       |
      | Description        | 1-3 sentences explaining the feature       |
      | Step Indicator     | "Step X of Y" in small gray text           |
      | Arrow              | Pointing toward the spotlighted element    |
    And the tooltip should auto-position to avoid going off-screen
    And it should support both left/right/top/bottom positioning

  # ---------- Demo Walkthrough Sequence ----------

  Scenario: Demo walks through all major features in order
    When the demo begins
    Then it should execute the following steps in sequence:
      | Step | Section            | Feature Highlighted          | Action                                    | Duration |
      | 1    | Welcome            | Full Page                    | Show welcome overlay with Vetted branding  | 4s       |
      | 2    | Sidebar            | Vetted. Logo                 | Highlight logo and brand identity          | 3s       |
      | 3    | Sidebar            | New Chat Button              | Highlight + New Chat, simulate click       | 3s       |
      | 4    | Chat               | Welcome State                | Show the welcome message area              | 3s       |
      | 5    | Chat               | Prompt Input                 | Spotlight input, simulate typing a prompt  | 5s       |
      | 6    | Chat               | Model Selector               | Open model dropdown, show Claude/ChatGPT/Gemini | 4s  |
      | 7    | Chat               | Temperature Control          | Show temperature slider adjustment         | 3s       |
      | 8    | Chat               | File Attachment              | Simulate attaching a file (paperclip icon) | 3s       |
      | 9    | Chat               | Send Message                 | Simulate clicking send                     | 2s       |
      | 10   | Chat               | Processing Pipeline          | Show the full 6-step progress bar animating through each step | 8s |
      | 11   | Chat               | AI Response Streaming        | Simulate a streaming response appearing    | 5s       |
      | 12   | Chat               | Model Reasoning              | Expand the Model Reasoning section         | 4s       |
      | 13   | Chat               | Response Actions             | Highlight copy, regenerate buttons         | 3s       |
      | 14   | Chat               | Chat Sharing                 | Show the share dialog                      | 3s       |
      | 15   | Sidebar            | Recent Chats                 | Highlight the new chat in Recent Chats     | 3s       |
      | 16   | Sidebar            | Shared With Me               | Highlight shared chats section             | 3s       |
      | 17   | Projects           | Projects Page                | Navigate to Projects, show page layout     | 4s       |
      | 18   | Projects           | My Projects Tab              | Highlight project cards with Owner badges  | 4s       |
      | 19   | Projects           | Create Project               | Simulate creating a new project            | 5s       |
      | 20   | Projects           | Project Detail               | Open a project, show chats/files/settings  | 5s       |
      | 21   | Library            | Library Page                 | Navigate to Library, show file list        | 4s       |
      | 22   | Library            | Storage Meter                | Highlight the storage usage meter          | 3s       |
      | 23   | Library            | File Upload                  | Simulate uploading a file                  | 4s       |
      | 24   | Library            | File Actions                 | Show download, rename, delete options      | 3s       |
      | 25   | Apps               | Apps Page                    | Navigate to Apps, show app cards grid      | 4s       |
      | 26   | Apps               | App Card Click               | Simulate clicking an app, show config      | 4s       |
      | 27   | Admin              | Admin Dashboard              | Navigate to Admin, show full dashboard     | 4s       |
      | 28   | Admin              | Resources Cards              | Highlight AI Tool Sets, Model Config, System Prompts | 5s |
      | 29   | Admin              | Quick Stats                  | Highlight Total Users, Active Today, Projects | 4s     |
      | 30   | Admin              | Support Tools                | Show AI Tool Sets Health, Model Health     | 4s       |
      | 31   | Admin              | User Management              | Show user table with role management       | 4s       |
      | 32   | Settings           | User Settings                | Open settings, show profile section        | 3s       |
      | 33   | Settings           | Preferences                  | Show chat preferences and toggles          | 3s       |
      | 34   | Settings           | API Keys                     | Highlight API key management               | 3s       |
      | 35   | Search             | Global Search                | Trigger Ctrl+K, show search modal          | 4s       |
      | 36   | Completion         | Full Page                    | Show completion overlay with summary       | 5s       |

  # ---------- Demo Simulated Data ----------

  Scenario: Demo uses pre-seeded sample data
    When the demo is active
    Then the following sample data should be available:
      | Data Type         | Sample Content                                     |
      | Sample User       | "Demo User" with Admin role                        |
      | Sample Project    | "Q1 Strategic Analysis" with 3 chats, 2 files      |
      | Sample Chat       | "Revenue Forecast Discussion" with 4 messages      |
      | Sample Files      | report.pdf (150KB), data.xlsx (85KB), notes.txt    |
      | Sample App        | "Financial Analyzer" app with custom config        |
      | Sample Prompt     | "Analyze our Q1 revenue trends and provide..."     |
      | Sample Response   | Multi-paragraph analysis with formatting            |
      | Sample Stats      | Total Users: 26, Active Today: 8, Projects: 15    |
      | Shared Chat       | "Marketing Strategy" shared by "Jane Smith"        |
      | Shared Project    | "Product Roadmap" shared with Editor permission    |

  Scenario: Demo simulates realistic typing animation
    When the demo reaches the prompt input step
    Then text should be "typed" character-by-character at a natural speed:
      | Property           | Value                                    |
      | Characters/second  | ~15 characters per second                |
      | Cursor             | Blinking cursor visible during typing    |
      | Variation          | Slight random delay variation for realism|
    And the simulated prompt should be: "Analyze our Q1 revenue performance and identify the top 3 growth opportunities for next quarter"

  Scenario: Demo simulates streaming AI response
    When the demo reaches the response streaming step
    Then the response should stream token-by-token at realistic speed
    And the response should contain formatted content:
      | Format Element  | Content                                          |
      | Heading         | "Q1 Revenue Analysis"                            |
      | Paragraph       | Summary paragraph of analysis                    |
      | Numbered List   | Top 3 growth opportunities                       |
      | Bold Text       | Key metrics and percentages                      |
      | Conclusion      | Brief recommendation paragraph                   |

  # ---------- Demo Navigation ----------

  Scenario: Demo automatically navigates between pages
    When the demo transitions from Chat to Projects
    Then the sidebar "Projects" item should visually highlight
    And the page should smoothly transition to the Projects page
    And a brief pause (500ms) should occur before the next spotlight

  Scenario: Demo handles page transitions with smooth animation
    Then all page transitions during the demo should use:
      | Property         | Value                                      |
      | Fade Duration    | 300ms ease-in-out                          |
      | Spotlight Move   | 400ms smooth transition between elements   |
      | Page Navigate    | 200ms fade out, navigate, 200ms fade in    |
      | Scroll           | Smooth scroll to target elements           |

  # ---------- Demo Welcome & Completion Overlays ----------

  Scenario: Demo starts with a welcome overlay
    When the demo first begins (Step 1)
    Then a full-screen overlay should appear:
      | Element          | Content                                      |
      | Logo             | "Vetted." in large serif font                |
      | Heading          | "Welcome to the Vetted AI Portal"            |
      | Subtext          | "This guided tour will walk you through all portal features" |
      | Duration Text    | "Approximately 2 minutes"                    |
      | Start Button     | "Begin Tour" (gold/amber primary button)     |
      | Skip Link        | "Skip Tour" link below                       |
    And the overlay should have a white background with subtle gold border

  Scenario: Demo ends with a completion overlay
    When the demo reaches the final step (Step 36)
    Then a full-screen completion overlay should appear:
      | Element          | Content                                      |
      | Logo             | "Vetted." logo                               |
      | Heading          | "Tour Complete"                              |
      | Subtext          | "You've seen all the key features of the Vetted AI Portal" |
      | Feature Summary  | Grid of icons for each major feature visited |
      | Replay Button    | "Replay Tour" (gold/amber button)            |
      | Start Button     | "Start Using Portal" (black primary button)  |
    And clicking "Start Using Portal" should close the overlay and return to normal mode

  # ---------- Demo Keyboard Shortcuts ----------

  Scenario: Keyboard controls for demo mode
    Given the demo is active
    Then the following keyboard shortcuts should work:
      | Key         | Action                       |
      | Space       | Toggle pause/play            |
      | Right Arrow | Skip to next step            |
      | Left Arrow  | Go back to previous step     |
      | Escape      | Open exit confirmation dialog |

  # ---------- Demo State Isolation ----------

  Scenario: Demo mode does not affect real user data
    When the demo is running
    Then all simulated actions should use demo/mock data only
    And no real chats should be created
    And no real files should be uploaded
    And no real settings should be modified
    And the database should not be altered by demo actions
    And after exiting demo mode, the portal should show real user data

  Scenario: Demo works for unauthenticated visitors
    Given the portal is in "demo mode only" configuration
    Then the demo should be playable without requiring login
    And after the demo completes, a login/contact CTA should appear
