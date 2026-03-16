@chat @core
Feature: Chat Interface and Conversations
  As a Vetted Portal user
  I want to interact with AI models through a clean chat interface
  So that I can get intelligent responses to my queries

  Background:
    Given I am authenticated and on the Vetted Portal
    And I am viewing the main chat interface

  # ---------- Welcome / New Chat State ----------

  Scenario: New chat displays welcome state
    Given I have started a new chat
    Then the main content area should display:
      | Element                | Description                                          |
      | Welcome Heading        | "Welcome to Vetted AI" in large serif font            |
      | Subtitle               | Brief description of capabilities                    |
      | Input Area             | "Ask anything" placeholder text in the prompt input   |
    And the background should be clean white (#FFFFFF)
    And the heading should use the Vetted serif typography
    And the gold/amber accent (#C4A962) should be used for decorative elements

  Scenario: Starting a new chat from sidebar
    Given I am viewing an existing chat
    When I click "New Chat" (+ icon) in the sidebar
    Then a new empty chat should be created
    And the welcome state should be displayed
    And the prompt input should be focused and ready for typing

  # ---------- Prompt Input ----------

  Scenario: User enters a text prompt
    Given I see the chat input area with "Ask anything" placeholder
    When I type "Analyze our Q1 sales performance"
    Then the input field should display my text
    And the send button should become active (gold/amber highlight)
    And the input area should auto-expand for longer text up to a maximum height

  Scenario: User submits a prompt via Enter key
    Given I have typed a prompt in the input area
    When I press the Enter key
    Then the prompt should be submitted to the AI model
    And my message should appear in the chat as a user message bubble
    And the AI processing pipeline should begin
    And the input area should be cleared and ready for the next message

  Scenario: User submits a prompt via send button
    Given I have typed a prompt in the input area
    When I click the Send button
    Then the prompt should be submitted to the AI model
    And my message should appear in the chat as a user message bubble

  Scenario: Multi-line prompt input with Shift+Enter
    Given I am typing in the prompt input area
    When I press Shift+Enter
    Then a new line should be created in the input area
    And the prompt should NOT be submitted

  Scenario: Empty prompt cannot be submitted
    Given the prompt input area is empty
    Then the send button should be disabled (grayed out)
    And pressing Enter should not submit anything

  # ---------- File Attachments in Chat ----------

  Scenario: Attach a file to a chat prompt
    Given I am composing a message in the chat input
    When I click the attachment icon (paperclip)
    Then a file picker dialog should open
    And I should be able to select files from my computer
    And supported file types should include: PDF, DOCX, XLSX, CSV, TXT, PNG, JPG

  Scenario: Attached file appears as a chip in the input area
    Given I have attached a file named "report.pdf"
    Then a file chip should appear above or within the input area showing:
      | Element     | Value               |
      | Icon        | PDF file type icon  |
      | Filename    | report.pdf          |
      | Remove (X)  | Button to remove    |
    And I should be able to add additional text to my prompt

  Scenario: Submit prompt with file attachment
    Given I have attached "report.pdf" and typed "Summarize this report"
    When I submit the prompt
    Then the file should be uploaded and included in the AI context
    And my message bubble should show both the text and the file attachment
    And the AI should process the file content along with the prompt

  Scenario: Drag and drop file attachment
    Given I am viewing the chat interface
    When I drag a file over the chat area
    Then a drop zone overlay should appear with Vetted styling
    And when I drop the file, it should be attached to the current prompt

  # ---------- Model Selection ----------

  Scenario: User selects an AI model for the chat
    Given I see the model selector in the chat interface
    When I click the model dropdown
    Then I should see a list of available AI models (demo mode — non-functional):
      | Model Name | Provider  | Icon Color | Status     |
      | Claude     | Anthropic | Purple     | Mock/Demo  |
      | ChatGPT    | OpenAI    | Green      | Mock/Demo  |
      | Gemini     | Google    | Blue       | Mock/Demo  |
    And the currently selected model should be highlighted with gold/amber accent
    And each model should display its provider name
    And a subtle "Demo" badge should appear next to each model
    And selecting a model stores the choice but does NOT call any external API

  Scenario: Default model is pre-selected
    Given I start a new chat
    Then the model selector should show the organization's default model
    And the default should be configurable by admins in Model Configuration

  Scenario: Changing model mid-conversation
    Given I am in an active chat using "Claude"
    When I change the model to "Gemini"
    Then subsequent messages should use the new model
    And a subtle system message should note the model change in the chat

  # ---------- Temperature Control ----------

  Scenario: User adjusts temperature setting
    Given I see the chat configuration options
    When I click on the temperature control
    Then a slider should appear with range 0.0 to 1.0
    And the current temperature value should be displayed numerically
    And a tooltip should explain the effect:
      | Low (0.0-0.3)   | More focused, deterministic responses |
      | Medium (0.4-0.7) | Balanced creativity and accuracy     |
      | High (0.8-1.0)   | More creative, varied responses      |

  # ---------- Chat Response Display ----------

  Scenario: AI response streams into the chat
    Given I have submitted a prompt
    When the AI model begins generating a response
    Then the response should stream token-by-token into the chat
    And a typing indicator should show the AI is generating
    And the chat should auto-scroll to follow the streaming response

  Scenario: Response includes formatted content
    Given the AI response contains markdown formatting
    Then the response should render:
      | Format          | Rendering                           |
      | Headers         | Styled headings with Vetted fonts   |
      | Bold            | Bold text                           |
      | Code blocks     | Syntax-highlighted code blocks      |
      | Lists           | Properly formatted bulleted/numbered|
      | Tables          | Clean bordered tables               |
      | Links           | Clickable hyperlinks in gold/amber  |

  Scenario: Copy response to clipboard
    Given an AI response is displayed in the chat
    When I click the copy icon on the response
    Then the response content should be copied to my clipboard
    And a brief "Copied!" toast notification should appear

  Scenario: Regenerate a response
    Given an AI response is displayed in the chat
    When I click the regenerate icon on the response
    Then the AI should generate a new response to the same prompt
    And the new response should replace or appear alongside the original

  # ---------- Chat History Persistence ----------

  Scenario: Chat is automatically saved
    Given I am in an active conversation
    Then the chat should be automatically saved after each message exchange
    And the chat should appear in the "Recent Chats" sidebar section
    And the chat title should be auto-generated from the first prompt

  Scenario: Continue a previous chat
    Given I click on a chat in "Recent Chats"
    Then the full conversation history should load
    And I should be able to continue the conversation
    And the same model and settings should be restored

  # ---------- Chat Sharing ----------

  Scenario: Share a chat with another user
    Given I am viewing one of my chats
    When I click the Share button in the chat header
    Then a share dialog should appear with Vetted styling
    And I should be able to:
      | Action                    | Description                          |
      | Search users              | Find users by name or email          |
      | Set permissions           | View-only or Edit access             |
      | Copy share link           | Generate a shareable link            |
      | Remove shared access      | Revoke previously shared access      |

  Scenario: Shared chat appears for recipient
    Given I have shared a chat with "Jane Smith"
    When Jane Smith logs into the portal
    Then the shared chat should appear in her "Shared With Me" section
    And she should see my name as the chat owner
