@notifications @toasts
Feature: Notifications and Toast Messages
  As a Vetted Portal user
  I want to receive timely notifications and feedback
  So that I stay informed about system events and action results

  Background:
    Given I am authenticated and on the Vetted Portal

  # ---------- Toast Notifications ----------

  Scenario: Success toast notification
    When I complete a successful action (e.g., save, upload, share)
    Then a success toast should appear in the top-right corner:
      | Property        | Value                                    |
      | Background      | #FFFFFF with left border #10B981 (green) |
      | Icon            | Green checkmark                          |
      | Title           | Action-specific (e.g., "File uploaded")  |
      | Duration        | Auto-dismiss after 4 seconds             |
      | Animation       | Slide in from right, fade out            |
      | Close Button    | Small X to dismiss early                 |

  Scenario: Error toast notification
    When an action fails (e.g., upload error, save failure)
    Then an error toast should appear:
      | Property        | Value                                    |
      | Background      | #FFFFFF with left border #EF4444 (red)   |
      | Icon            | Red exclamation circle                   |
      | Title           | Error description                        |
      | Detail          | Brief explanation of what went wrong     |
      | Duration        | Persists until dismissed (no auto-close) |
      | Action          | Optional "Retry" button                  |

  Scenario: Warning toast notification
    When a cautionary event occurs (e.g., approaching storage limit)
    Then a warning toast should appear:
      | Property        | Value                                    |
      | Background      | #FFFFFF with left border #F59E0B (amber) |
      | Icon            | Amber warning triangle                   |
      | Duration        | Auto-dismiss after 6 seconds             |

  Scenario: Multiple toasts stack vertically
    When multiple toast notifications trigger in quick succession
    Then they should stack vertically from the top-right
    And a maximum of 3 toasts should be visible simultaneously
    And older toasts should dismiss to make room for new ones

  # ---------- In-App Notifications ----------

  Scenario: Notification bell displays unread count
    Given I have unread notifications
    Then the notification bell icon should display a badge with the unread count
    And the badge should use gold/amber (#C4A962) background with white text

  Scenario: View notification panel
    When I click the notification bell icon
    Then a dropdown notification panel should appear:
      | Element             | Description                              |
      | Header              | "Notifications" with "Mark all read" link|
      | Notification List   | Scrollable list of notifications         |
      | Empty State         | "No new notifications" if none exist     |
    And each notification should display:
      | Element       | Description                                |
      | Icon          | Type-specific icon (share, project, system)|
      | Title         | Brief notification title                   |
      | Description   | Detail text                                |
      | Timestamp     | Relative time (e.g., "5 min ago")          |
      | Read Status   | Unread items have subtle gold left border  |

  Scenario: Notification types
    Then the following notification types should be supported:
      | Type                | Trigger                                     |
      | Chat Shared         | Someone shares a chat with you              |
      | Project Shared      | Someone shares a project with you           |
      | Project Update      | A shared project is modified                |
      | System Announcement | Admin posts a system-wide announcement      |
      | Model Status Change | An AI model goes down or comes back online  |

  Scenario: Clicking a notification navigates to context
    Given I have a "Chat Shared" notification
    When I click on the notification
    Then I should be navigated to the shared chat
    And the notification should be marked as read
