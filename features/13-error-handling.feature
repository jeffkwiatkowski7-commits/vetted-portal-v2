@errors @resilience
Feature: Error Handling and Edge Cases
  As a Vetted Portal user
  I want graceful error handling throughout the portal
  So that I can recover from issues without losing work

  Background:
    Given I am authenticated and on the Vetted Portal

  # ---------- Network Errors ----------

  Scenario: Network disconnection during chat
    Given I am in an active chat conversation
    When my network connection drops
    Then a subtle banner should appear at the top of the page:
      | Element       | Style                                       |
      | Background    | #FEF3C7 (light amber)                       |
      | Icon          | Amber warning icon                          |
      | Message       | "Connection lost. Reconnecting..."          |
      | Animation     | Pulsing dot to indicate retry attempts      |
    And my typed message should be preserved in the input area
    When the connection is restored
    Then the banner should update to "Connection restored" (green)
    And the banner should auto-dismiss after 3 seconds

  Scenario: Network disconnection during file upload
    Given I am uploading a file to the Library
    When my network connection drops mid-upload
    Then the upload progress should show a paused/error state
    And a "Retry Upload" button should appear
    When I click "Retry Upload" after connection restores
    Then the upload should resume or restart

  # ---------- AI Model Errors ----------

  Scenario: AI model returns an error response
    Given I have submitted a prompt
    When the AI model returns an error
    Then an error message should appear in the chat:
      | Element          | Style                                    |
      | Container        | Light red background card                |
      | Icon             | Red error icon                           |
      | Message          | "Something went wrong. Please try again."|
      | Retry Button     | Vetted secondary button style            |
    And my original prompt should remain visible
    When I click "Retry"
    Then the same prompt should be resubmitted to the model

  Scenario: AI model timeout
    Given I have submitted a prompt
    When the model does not respond within 60 seconds
    Then the processing pipeline should show a timeout error at the active step
    And a message should display: "Request timed out"
    And options should include "Retry" and "Try a different model"

  Scenario: Rate limit exceeded
    Given I have been sending many prompts in rapid succession
    When I hit the rate limit
    Then a message should display: "Rate limit reached. Please wait a moment."
    And the send button should be temporarily disabled
    And a countdown timer should show when I can send again

  # ---------- Form Validation Errors ----------

  Scenario: Required field validation
    Given I am filling out a form (e.g., Create Project)
    When I try to submit with required fields empty
    Then each empty required field should show a red border
    And an error message below each field: "[Field name] is required"
    And the form should scroll to the first error
    And the submit button should not trigger the action

  Scenario: Character limit validation
    Given a field has a maximum character limit
    When I exceed the limit
    Then a character counter should turn red (e.g., "105/100")
    And the submit button should be disabled until corrected

  # ---------- 404 / Not Found ----------

  Scenario: Navigate to a non-existent page
    When I navigate to an invalid URL within the portal
    Then a 404 page should display with Vetted branding:
      | Element          | Description                              |
      | Heading          | "Page Not Found" in Vetted serif font    |
      | Subtext          | "The page you're looking for doesn't exist"|
      | Home Button      | "Back to Home" in Vetted primary style   |
    And the sidebar should remain visible for navigation

  Scenario: Access a deleted or unavailable resource
    Given a chat or project has been deleted
    When I navigate to it via a direct link or bookmark
    Then a message should display: "This resource is no longer available"
    And a "Go to Home" button should be provided

  # ---------- Permission Errors ----------

  Scenario: Access denied to a resource
    Given I try to access a project I don't have permission for
    Then a permission error page should display:
      | Element          | Description                              |
      | Heading          | "Access Denied"                          |
      | Subtext          | "You don't have permission to view this" |
      | Action           | "Request Access" button                  |

  # ---------- Data Preservation ----------

  Scenario: Unsaved changes warning
    Given I have unsaved changes in a form (e.g., project settings)
    When I try to navigate away
    Then a confirmation dialog should appear:
      | Element     | Content                                    |
      | Title       | "Unsaved Changes"                          |
      | Message     | "You have unsaved changes. Discard them?"  |
      | Stay        | "Keep Editing" (primary button)            |
      | Leave       | "Discard" (secondary button)               |

  Scenario: Browser refresh preserves chat draft
    Given I have typed text in the chat input but not submitted
    When I refresh the browser
    Then the draft text should be preserved in the input area
    And the current chat view should be restored
