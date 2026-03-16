@sidebar @navigation @layout
Feature: Sidebar Navigation and Layout
  As a Vetted Portal user
  I want a persistent sidebar for navigation
  So that I can quickly access all portal sections and my chat history

  Background:
    Given I am authenticated and on the Vetted Portal
    And the sidebar is displayed on the left side of the screen

  # ---------- Sidebar Structure ----------

  Scenario: Sidebar displays all primary navigation elements
    Then the sidebar should contain the following sections in order:
      | Section          | Icon     | Position   |
      | Vetted. Logo     | Logo     | Top        |
      | New Chat         | + Icon   | Top        |
      | Projects         | Folder   | Top Nav    |
      | Library          | Book     | Top Nav    |
      | Apps             | Grid     | Top Nav    |
      | Admin            | Shield   | Top Nav    |
      | Project Chats    | --       | Middle     |
      | Recent Chats     | --       | Middle     |
      | Shared With Me   | --       | Bottom     |
      | User Profile     | Avatar   | Footer     |
    And the sidebar should have a clean white background
    And navigation icons should use the Vetted gold/amber accent color (#C4A962) on hover and active states
    And the active section should be highlighted with a subtle background change

  Scenario: Admin navigation is hidden for non-admin users
    Given I am logged in as a Standard User
    Then the sidebar should NOT display the "Admin" navigation item
    And all other navigation items should be visible

  # ---------- Sidebar Collapse/Expand ----------

  Scenario: Sidebar collapse toggle
    Given the sidebar is expanded showing full labels
    When I click the sidebar collapse button
    Then the sidebar should collapse to show only icons
    And the main content area should expand to fill the available space
    And tooltips should appear when hovering over collapsed icons

  Scenario: Sidebar expand toggle
    Given the sidebar is collapsed showing only icons
    When I click the sidebar expand button
    Then the sidebar should expand to show full labels
    And the main content area should adjust width accordingly

  # ---------- Project Chats Section ----------

  Scenario: Project Chats section displays active project conversations
    Given I have active chats within projects
    Then the "Project Chats" section should display a list of project-related chats
    And each entry should show the project name and last message preview
    And entries should be sorted by most recent activity
    And clicking a project chat should open it in the main content area

  Scenario: Empty Project Chats section
    Given I have no active project chats
    Then the "Project Chats" section should display a subtle empty state message
    And a prompt to "Start a chat in a project" should be shown

  # ---------- Recent Chats Section ----------

  Scenario: Recent Chats section lists personal chat history
    Given I have previous chat conversations
    Then the "Recent Chats" section should display my recent conversations
    And each entry should show the chat title or first message preview
    And entries should be sorted by most recent first
    And a maximum of 20 recent chats should be visible with scroll

  Scenario: Clicking a recent chat opens it
    Given I see a chat titled "Budget Analysis Q1" in Recent Chats
    When I click on "Budget Analysis Q1"
    Then the main content area should load that conversation
    And all previous messages and responses should be displayed
    And the chat input should be ready for a new message

  Scenario: Rename a recent chat
    Given I see a chat in the Recent Chats section
    When I right-click on the chat entry
    And I select "Rename" from the context menu
    Then the chat title should become an editable text field
    And I should be able to type a new name and press Enter to save

  Scenario: Delete a recent chat
    Given I see a chat in the Recent Chats section
    When I right-click on the chat entry
    And I select "Delete" from the context menu
    Then a confirmation dialog should appear with Vetted styling
    And if I confirm, the chat should be removed from the list
    And the chat data should be permanently deleted

  # ---------- Shared With Me Section ----------

  Scenario: Shared With Me section displays shared conversations
    Given other users have shared chats with me
    Then the "Shared With Me" section should display those shared conversations
    And each entry should show the chat title and who shared it
    And entries should include a visual indicator (share icon) distinguishing them from personal chats

  Scenario: Opening a shared chat
    Given I see a shared chat in the "Shared With Me" section
    When I click on the shared chat
    Then it should open in the main content area
    And I should see a banner indicating "Shared by [Username]"
    And my permissions (view-only or edit) should be respected

  # ---------- User Profile Footer ----------

  Scenario: User profile section displays current user info
    Then the bottom of the sidebar should display:
      | Element       | Description                          |
      | Avatar        | User profile image or initials       |
      | Name          | User's display name                  |
      | Role Badge    | Small badge showing role (e.g. Admin)|
    And clicking the profile area should open a dropdown with:
      | Option        |
      | Settings      |
      | Sign Out      |
