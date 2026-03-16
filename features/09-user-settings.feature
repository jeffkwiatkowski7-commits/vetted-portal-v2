@settings @user
Feature: User Settings and Preferences
  As a Vetted Portal user
  I want to manage my profile and preferences
  So that I can customize my portal experience

  Background:
    Given I am authenticated and on the Vetted Portal
    And I have opened the Settings page from my profile dropdown

  # ---------- Settings Page Layout ----------

  Scenario: Settings page displays all sections
    Then the Settings page should display the following sections:
      | Section              | Description                                    |
      | Profile              | User profile information                       |
      | Preferences          | Chat and UI preferences                        |
      | Notifications        | Notification settings                          |
      | API Keys             | Personal API key management                    |
      | Security             | Password, 2FA, active sessions                 |
    And the layout should use a left-nav tab or vertical accordion pattern
    And styling should follow the Vetted clean white design

  # ---------- Profile Section ----------

  Scenario: View and edit profile information
    When I navigate to the Profile section
    Then I should see and be able to edit:
      | Field              | Type          | Editable |
      | Display Name       | Text input    | Yes      |
      | Email              | Text input    | No (SSO) |
      | Job Title          | Text input    | Yes      |
      | Department         | Text input    | Yes      |
      | Profile Photo      | Image upload  | Yes      |
      | Role               | Badge         | No       |

  Scenario: Update display name
    Given I am in the Profile section
    When I change my display name to "Jacob M."
    And I click "Save Changes"
    Then my display name should update across the portal
    And the sidebar profile footer should reflect the new name
    And a success toast should appear

  Scenario: Upload profile photo
    When I click the profile photo area
    Then a file picker should open for image files (JPG, PNG)
    When I select an image
    Then a preview and crop tool should appear
    When I confirm the crop
    Then my profile photo should update across the portal

  # ---------- Preferences Section ----------

  Scenario: Configure chat preferences
    When I navigate to the Preferences section
    Then I should see the following preference options:
      | Preference             | Type      | Default        | Description                      |
      | Default Model          | Dropdown  | Org default    | My preferred AI model            |
      | Default Temperature    | Slider    | 0.7            | My preferred temperature setting |
      | Show Model Reasoning   | Toggle    | Off            | Show AI reasoning by default     |
      | Auto-scroll Responses  | Toggle    | On             | Auto-scroll during streaming     |
      | Compact Chat View      | Toggle    | Off            | Reduce spacing in chat messages  |
      | Code Theme             | Dropdown  | Light          | Syntax highlighting theme        |

  Scenario: Save preferences
    Given I have modified my preferences
    When I click "Save Preferences"
    Then preferences should be persisted to my profile
    And subsequent chats should use my saved preferences
    And a success confirmation should appear

  # ---------- Notification Settings ----------

  Scenario: Configure notification preferences
    When I navigate to the Notifications section
    Then I should see notification toggles:
      | Notification Type          | Channels       | Default |
      | Shared Chat Notifications  | In-app, Email  | On      |
      | Project Updates            | In-app, Email  | On      |
      | System Announcements       | In-app         | On      |
      | Weekly Usage Summary       | Email          | Off     |

  # ---------- API Keys ----------

  Scenario: View personal API keys
    When I navigate to the API Keys section
    Then I should see a list of my personal API keys (if any)
    And each key should display:
      | Element        | Description                              |
      | Key Name       | Descriptive label for the key            |
      | Key Preview    | Last 4 characters only (masked)          |
      | Created Date   | When the key was created                 |
      | Last Used      | When the key was last used               |
      | Status         | Active/Revoked                           |
      | Actions        | Revoke, Copy                             |

  Scenario: Generate a new API key
    When I click "+ Generate API Key"
    Then a dialog should appear:
      | Field          | Type        | Required |
      | Key Name       | Text input  | Yes      |
      | Expiration     | Dropdown    | Yes      |
      | Permissions    | Checkboxes  | Yes      |
    And expiration options should include: 30 days, 90 days, 1 year, No expiration
    When I fill in the form and click "Generate"
    Then the full API key should be displayed ONCE
    And a warning should state "This key will not be shown again"
    And a "Copy to Clipboard" button should be available
    When I dismiss the dialog
    Then the key should appear in the list (masked)

  Scenario: Revoke an API key
    Given I have an active API key
    When I click "Revoke" on the key
    Then a confirmation dialog should appear
    When I confirm
    Then the key should be immediately invalidated
    And its status should change to "Revoked"
    And any API requests using this key should begin failing

  # ---------- Security Section ----------

  Scenario: View active sessions
    When I navigate to the Security section
    Then I should see a list of my active sessions:
      | Column         | Description                           |
      | Device         | Browser/device description            |
      | IP Address     | Session IP (partially masked)         |
      | Location       | Approximate location                  |
      | Last Active    | Last activity timestamp               |
      | Actions        | Terminate session                     |

  Scenario: Terminate a remote session
    Given I see an active session on a device I don't recognize
    When I click "Terminate" on that session
    Then the session should be immediately ended
    And the user on that device should be logged out
    And the session should be removed from the list
