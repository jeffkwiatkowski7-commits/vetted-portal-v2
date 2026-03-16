@apps @tools
Feature: Apps and AI Tool Sets
  As a Vetted Portal user
  I want to access and manage custom AI apps and tool sets
  So that I can use specialized AI capabilities for specific tasks

  Background:
    Given I am authenticated and on the Vetted Portal
    And I have navigated to the Apps page via the sidebar

  # ---------- Apps Page Layout ----------

  Scenario: Apps page displays with correct layout
    Then the Apps page should display:
      | Element                | Description                                        |
      | Page Header            | "Apps" in Vetted serif typography                  |
      | Search Bar             | Search input with "Search apps..." placeholder     |
      | Category Filters       | Filter chips/tabs for app categories               |
      | Apps Grid              | Grid of app cards                                  |
    And the layout should follow the Vetted clean white design

  # ---------- App Cards ----------

  Scenario: App card displays relevant information
    Given there are apps available to me
    Then each app card should display:
      | Element          | Description                                       |
      | App Icon         | Custom icon or default grid icon                  |
      | App Name         | Bold title in Vetted typography                   |
      | Description      | Brief description of the app's purpose            |
      | Category Tag     | Category label (e.g., "Analysis", "Writing")      |
      | Usage Count      | Number of times the app has been used             |
      | Status Badge     | Active/Inactive indicator                         |
    And the card should have a subtle border and Vetted white background
    And on hover, the card should show a subtle shadow elevation

  Scenario: Click an app to start a conversation
    Given I see an app card for "Document Analyzer"
    When I click on the app card
    Then a new chat should be started with the app's configuration:
      | Config Element     | Description                                    |
      | System Prompt      | Pre-configured prompt for the app              |
      | Model              | App's designated AI model                      |
      | Tool Sets          | App-specific tool sets pre-loaded              |
      | Temperature        | App's configured temperature setting           |
    And the chat should display the app name in the header
    And any app-specific instructions should be shown as a welcome message

  # ---------- App Categories ----------

  Scenario: Filter apps by category
    Given apps are tagged with categories
    When I click a category filter chip (e.g., "Analysis")
    Then only apps in that category should be displayed
    And the active filter chip should be highlighted in gold/amber
    And I should be able to select multiple category filters

  Scenario: Clear category filters
    Given I have active category filters
    When I click "Clear Filters" or deselect all chips
    Then all apps should be displayed again

  # ---------- App Search ----------

  Scenario: Search for an app by name
    When I type "Budget" in the search bar
    Then only apps containing "Budget" in the name or description should appear
    And the search should be case-insensitive and debounced

  # ---------- Custom App Creation (Admin) ----------

  Scenario: Admin creates a custom app
    Given I am an Admin user
    And I see a "+ Create App" button on the Apps page
    When I click "+ Create App"
    Then a creation form should appear with:
      | Field               | Type          | Required |
      | App Name            | Text input    | Yes      |
      | Description         | Text area     | Yes      |
      | Icon                | Image upload  | No       |
      | Category            | Dropdown      | Yes      |
      | System Prompt       | Text area     | Yes      |
      | AI Model            | Dropdown      | Yes      |
      | Temperature         | Slider        | No       |
      | AI Tool Sets        | Multi-select  | No       |
      | Visibility          | Radio buttons | Yes      |
    And Visibility options should include:
      | Option       | Description                        |
      | All Users    | Available to everyone              |
      | Admin Only   | Only visible to admins             |
      | Specific     | Available to selected users/groups |

  Scenario: Successfully create an app
    Given I have filled in all required app fields
    When I click "Create App"
    Then the app should be created and appear in the Apps grid
    And users with access should see it on their Apps page
    And a success notification should appear

  # ---------- App Management (Admin) ----------

  Scenario: Edit an existing app
    Given I am an Admin and I see an app I created
    When I click the edit icon or select "Edit" from the app's menu
    Then the app editing form should load with current values
    And I should be able to modify all fields
    When I save changes
    Then the app should be updated for all users

  Scenario: Disable an app
    Given I am an Admin
    When I toggle an app's status to "Inactive"
    Then the app should no longer appear for standard users
    And it should show a "Disabled" badge for admins
    And existing chats using the app should still function

  Scenario: Delete an app
    Given I am an Admin
    When I select "Delete" from an app's menu
    Then a confirmation dialog should warn about permanent deletion
    When I confirm
    Then the app should be removed from the Apps grid
    And existing chats that used the app should retain their history

  # ---------- App Usage in Projects ----------

  Scenario: Add an app to a project
    Given I am configuring a project's tool sets
    When I select apps from the available apps list
    Then those apps' tool sets should be available in all project chats
    And the project card should show the updated tool set count
