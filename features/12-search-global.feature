@search @global
Feature: Global Search
  As a Vetted Portal user
  I want to search across all portal content from one place
  So that I can quickly find chats, projects, files, and apps

  Background:
    Given I am authenticated and on the Vetted Portal

  # ---------- Global Search Trigger ----------

  Scenario: Open global search with keyboard shortcut
    When I press Ctrl+K (or Cmd+K on Mac)
    Then a search modal should appear centered on screen:
      | Element           | Style                                      |
      | Overlay           | Semi-transparent dark backdrop              |
      | Search Box        | Large input with magnifying glass icon      |
      | Placeholder       | "Search chats, projects, files, apps..."    |
      | Border            | Gold/amber focus ring                       |
    And the search input should be auto-focused

  Scenario: Open global search from sidebar
    Given there is a search icon in the sidebar header area
    When I click the search icon
    Then the global search modal should appear

  # ---------- Search Results ----------

  Scenario: Search returns categorized results
    Given I type "budget" in the global search
    Then results should be grouped by category:
      | Category    | Description                                  |
      | Chats       | Chat conversations containing "budget"       |
      | Projects    | Projects with "budget" in name/description   |
      | Files       | Library files with "budget" in filename      |
      | Apps        | Apps matching "budget"                       |
    And each category should show a maximum of 3 results with a "View all" link
    And results should update in real-time as I type (debounced 300ms)

  Scenario: Search result item displays relevant info
    Then each search result item should show:
      | Element        | Description                               |
      | Icon           | Category-specific icon                    |
      | Title          | Matching title with search term bolded    |
      | Subtitle       | Context snippet or metadata               |
      | Timestamp      | Last modified/used date                   |
    And clicking a result should navigate to that item
    And the search modal should close on navigation

  Scenario: Search with no results
    Given I type "xyznonexistent" in the global search
    Then an empty state should display "No results for 'xyznonexistent'"
    And suggestions should be shown (e.g., "Try different keywords")

  Scenario: Recent searches
    Given I open the global search with an empty query
    Then my recent search terms should be displayed
    And clicking a recent term should re-execute that search

  Scenario: Close global search
    When I press Escape or click outside the search modal
    Then the search modal should close
    And focus should return to the previous context
