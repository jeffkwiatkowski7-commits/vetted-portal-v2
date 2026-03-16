@processing @pipeline @progress-bar
Feature: AI Processing Pipeline and Progress Bar
  As a Vetted Portal user
  I want to see a detailed progress bar showing each step of AI processing
  So that I understand what the system is doing with my prompt

  Background:
    Given I am authenticated and in an active chat
    And I have submitted a prompt to the AI

  # ---------- Progress Bar Display ----------

  Scenario: Progress bar appears after prompt submission
    When the AI begins processing my prompt
    Then a vertical progress bar / pipeline should appear in the chat area
    And the progress bar should follow the Vetted design:
      | Element              | Style                                            |
      | Container            | Clean white card with subtle border               |
      | Step Indicators      | Circular dots/checkmarks connected by a line      |
      | Active Step          | Gold/amber (#C4A962) animated pulse               |
      | Completed Step       | Green checkmark or filled gold circle             |
      | Pending Step         | Gray outline circle                               |
      | Step Labels          | Sans-serif font, clear and readable               |
      | Timestamps           | Small gray text showing elapsed time per step     |

  Scenario: Pipeline shows all processing steps in sequence
    When the AI processing pipeline is active
    Then the following steps should be displayed in order with timestamps:
      | Step Number | Step Name            | Description                              |
      | 1           | Resolving chat       | Identifying chat context and parameters  |
      | 2           | Discovering tools    | Finding available tools and capabilities |
      | 3           | Loading history      | Loading relevant conversation history    |
      | 4           | Building prompt      | Assembling the full prompt with context  |
      | 5           | Calling [Model Name] | Sending request to the selected AI model |
      | 6           | Streaming response   | Receiving and displaying the AI response |
    And each step should show a timestamp (e.g., "0.2s", "1.5s")

  # ---------- Step-by-Step Progression ----------

  Scenario: Step 1 - Resolving chat
    When the pipeline begins
    Then "Resolving chat" should become the active step
    And the step indicator should show a gold/amber animated state
    And a timestamp should begin counting
    When the step completes
    Then the indicator should change to a completed state (checkmark)
    And the elapsed time should be frozen (e.g., "0.1s")

  Scenario: Step 2 - Discovering tools
    When "Resolving chat" is completed
    Then "Discovering tools" should become the active step
    And the system should identify available AI tool sets
    And the progress indicator should advance to step 2

  Scenario: Step 3 - Loading history
    When "Discovering tools" is completed
    Then "Loading history" should become the active step
    And relevant conversation context should be loaded
    And if this is a new chat, this step should complete quickly

  Scenario: Step 4 - Building prompt
    When "Loading history" is completed
    Then "Building prompt" should become the active step
    And the system should assemble the full prompt including:
      | Component          | Description                                    |
      | System prompt      | Organization-configured system prompt           |
      | Chat history       | Relevant previous messages                     |
      | User prompt        | The current user message                       |
      | File attachments   | Any attached document content                  |
      | Tool definitions   | Available tool schemas                         |

  Scenario: Step 5 - Calling the AI model
    When "Building prompt" is completed
    Then "Calling [Model Name]" should become the active step
    And the step label should include the selected model name (e.g., "Calling Claude", "Calling ChatGPT", or "Calling Gemini")
    And this step should remain active until the model begins responding

  Scenario: Step 6 - Streaming response
    When the AI model begins generating a response
    Then "Streaming response" should become the active step
    And the response should begin streaming into the chat area below the pipeline
    And when streaming completes, all steps should show completed state

  # ---------- Model Reasoning Section ----------

  Scenario: Model Reasoning expandable section
    When the AI response includes reasoning/thinking data
    Then a "Model Reasoning" expandable section should appear
    And it should be styled as a collapsible card with Vetted design:
      | Element            | Style                                           |
      | Header             | "Model Reasoning" with expand/collapse chevron  |
      | Background         | Slightly tinted background (light gray or cream) |
      | Border             | Subtle left border in gold/amber accent          |
      | Content            | Monospace or slightly smaller font               |
    And by default it should be collapsed
    When I click to expand it
    Then the internal reasoning chain should be displayed
    And it should show the AI's step-by-step thought process

  # ---------- Progress Bar Completion States ----------

  Scenario: All steps complete successfully
    When all 6 pipeline steps have completed
    Then all step indicators should show completed state (checkmarks)
    And each step should display its elapsed time
    And the total processing time should be shown at the bottom
    And the progress bar should fade or minimize after a brief delay

  Scenario: Error occurs during processing
    When an error occurs at any pipeline step
    Then the failed step should show an error indicator (red)
    And an error message should be displayed below the failed step
    And a "Retry" button should appear styled with Vetted design
    And subsequent steps should remain in pending (gray) state

  Scenario: User cancels during processing
    Given the processing pipeline is actively running
    When I click the "Stop" button
    Then the pipeline should halt at the current step
    And the current step should show a cancelled state
    And a message "Generation stopped" should appear
    And I should be able to edit my prompt and resubmit

  # ---------- Performance Timing ----------

  Scenario: Pipeline step timing is accurate
    When each pipeline step completes
    Then the timestamp should accurately reflect the elapsed time in seconds
    And the format should be consistent (e.g., "0.2s", "1.5s", "3.0s")
    And very fast steps (< 0.1s) should show "< 0.1s"

  Scenario: Long-running step shows elapsed timer
    When a pipeline step takes longer than 3 seconds
    Then the timestamp should update in real-time as a running counter
    And if the step exceeds 30 seconds, a warning indicator should appear
    And if the step exceeds 60 seconds, a timeout message should be shown with retry option
