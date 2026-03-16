@projects
Feature: Projects Management
  As a Vetted Portal user
  I want to organize my AI work into projects
  So that I can manage related chats, files, and tools in one place

  Background:
    Given I am authenticated and on the Vetted Portal
    And I have navigated to the Projects page via the sidebar

  # ---------- Projects Page Layout ----------

  Scenario: Projects page displays with correct layout
    Then the Projects page should display:
      | Element                | Description                                          |
      | Page Header            | "Projects" in Vetted serif typography                |
      | Tab Bar                | "My Projects" and "Shared With Me" tabs              |
      | Search Bar             | Search input with placeholder "Search projects..."   |
      | New Project Button     | "+ New Project" button in Vetted primary style        |
      | Project Cards Grid     | Grid of project cards below the tabs                 |
    And the "My Projects" tab should be active by default
    And the tab should show count in parentheses (e.g., "My Projects (3)")

  Scenario: My Projects tab shows owned projects
    Given I have created 3 projects
    When I view the "My Projects" tab
    Then I should see 3 project cards
    And each card should display:
      | Element          | Description                                     |
      | Project Name     | Bold title in Vetted typography                 |
      | Owner Badge      | "Owner" badge in gold/amber accent              |
      | Description      | Brief project description (truncated if long)   |
      | Tool Sets Count  | Number of AI tool sets assigned                 |
      | Updated Date     | "Updated [relative time]" (e.g., "Updated 2d ago")|
      | Chat Count       | Number of chats in the project                  |

  Scenario: Shared With Me tab shows shared projects
    When I click the "Shared With Me" tab
    Then I should see projects that others have shared with me
    And each card should show the owner's name instead of "Owner" badge
    And my permission level should be indicated (Viewer/Editor)

  # ---------- Create New Project ----------

  Scenario: Create a new project
    When I click "+ New Project"
    Then a project creation dialog should appear with Vetted styling:
      | Field             | Type        | Required |
      | Project Name      | Text input  | Yes      |
      | Description       | Text area   | No       |
      | AI Tool Sets      | Multi-select| No       |
      | System Prompt     | Text area   | No       |
      | Model Selection   | Dropdown    | Yes      |
    And the dialog should have "Create" (primary) and "Cancel" (secondary) buttons

  Scenario: Successfully create a project
    Given I have filled in the project creation form:
      | Field           | Value                           |
      | Project Name    | Q1 Budget Analysis              |
      | Description     | Analyzing quarterly budget data |
    When I click "Create"
    Then the project should be created successfully
    And a new project card should appear in "My Projects"
    And I should be navigated to the new project's detail view

  Scenario: Project name validation
    Given the project creation dialog is open
    When I try to create a project without a name
    Then a validation error should appear: "Project name is required"
    And the "Create" button should remain disabled

  # ---------- Project Detail View ----------

  Scenario: Viewing a project detail page
    Given I click on a project card named "Q1 Budget Analysis"
    Then the project detail page should load with:
      | Section          | Description                                        |
      | Header           | Project name with edit icon, owner info             |
      | Description      | Editable project description                       |
      | Chats List       | List of all chats within this project               |
      | Files Section    | Files attached to this project                     |
      | Settings         | Project settings (model, tools, system prompt)     |
      | Members          | List of shared users and their permissions          |

  Scenario: Start a new chat within a project
    Given I am on a project detail page
    When I click "New Chat" or the "+ New Chat" button
    Then a new chat should be created within this project context
    And the project's system prompt should be pre-loaded
    And the project's AI tool sets should be available
    And the project's selected model should be the default
    And this chat should appear in the sidebar under "Project Chats"

  # ---------- Project Files ----------

  Scenario: Upload files to a project
    Given I am on a project detail page
    When I click "Upload Files" in the Files section
    And I select files from my computer
    Then the files should be uploaded to the project
    And the files should be available as context for all chats in this project
    And file count should update in the project card

  Scenario: Files in project are accessible to project chats
    Given a project has uploaded files
    When I start a new chat in that project
    Then the AI should have access to the project's files as context
    And I should be able to reference project files by name in my prompts

  # ---------- Project Sharing ----------

  Scenario: Share a project with another user
    Given I am the owner of a project
    When I click the "Share" button on the project
    Then a share dialog should appear
    And I should be able to search for users by name or email
    And I should be able to set permissions:
      | Permission | Description                                       |
      | Viewer     | Can view chats and files, cannot edit              |
      | Editor     | Can create chats, upload files, modify settings    |
    When I add a user and click "Share"
    Then the user should be added to the project members list
    And the project should appear in their "Shared With Me" tab

  Scenario: Remove a user from a shared project
    Given I am the owner and a project is shared with "Jane Smith"
    When I open the project members list
    And I click "Remove" next to Jane Smith
    Then a confirmation dialog should appear
    And if I confirm, Jane should lose access to the project
    And the project should be removed from her "Shared With Me" tab

  # ---------- Project Settings ----------

  Scenario: Edit project settings
    Given I am the owner of a project
    When I navigate to the project's Settings section
    Then I should be able to modify:
      | Setting             | Description                              |
      | Project Name        | Rename the project                       |
      | Description         | Update the description                   |
      | AI Tool Sets        | Add/remove available tool sets           |
      | System Prompt       | Customize the system prompt              |
      | Default Model       | Change the default AI model              |
      | Temperature         | Set default temperature                  |

  Scenario: Delete a project
    Given I am the owner of a project
    When I click "Delete Project" in settings
    Then a confirmation dialog should appear warning:
      | Warning Item                                           |
      | All chats in this project will be permanently deleted |
      | All uploaded files will be removed                    |
      | Shared users will lose access                         |
    And I must type the project name to confirm deletion
    When I confirm
    Then the project and all its contents should be permanently deleted

  # ---------- Project Search ----------

  Scenario: Search for projects by name
    Given I am on the Projects page
    When I type "Budget" in the search bar
    Then only projects containing "Budget" in the name should be displayed
    And the search should be case-insensitive
    And results should update as I type (debounced)

  Scenario: Search returns no results
    Given I am on the Projects page
    When I type "xyznonexistent" in the search bar
    Then an empty state should display "No projects found"
    And a suggestion to "Create a new project" should be shown
