@admin @dashboard
Feature: Admin Dashboard
  As a Vetted Portal administrator
  I want a comprehensive admin dashboard
  So that I can manage users, models, tools, prompts, and monitor system health

  Background:
    Given I am authenticated as an Admin user
    And I have navigated to the Admin page via the sidebar

  # ---------- Admin Dashboard Layout ----------

  Scenario: Admin dashboard displays with correct layout
    Then the Admin Dashboard should display the following sections:
      | Section            | Description                                          |
      | Page Header        | "Admin Dashboard" in Vetted serif typography         |
      | Resources          | Cards for AI Tool Sets, Model Configuration, System Prompts |
      | Quick Stats        | Summary statistics cards                             |
      | Support Tools      | Health monitoring and support tools                   |
    And the layout should use a card-based grid following Vetted design
    And each section should have generous spacing and clean white backgrounds

  # ---------- Resources Section ----------

  Scenario: Resources section displays management cards
    Then the Resources section should display three cards:
      | Card                  | Icon    | Description                              |
      | AI Tool Sets          | Tools   | Manage available AI tool configurations  |
      | Model Configuration   | Brain   | Configure AI model settings and defaults |
      | System Prompts        | Code    | Manage system-level prompts              |
    And each card should be clickable to navigate to its management page
    And cards should have a subtle border and gold/amber icon accent
    And on hover, cards should show a subtle elevation shadow

  # ---------- AI Tool Sets Management ----------

  Scenario: Navigate to AI Tool Sets management
    When I click the "AI Tool Sets" card
    Then I should see a list of configured tool sets
    And each tool set should display:
      | Element        | Description                               |
      | Name           | Tool set name                             |
      | Description    | What the tool set does                    |
      | Status         | Active/Inactive toggle                    |
      | Usage Count    | How many projects/chats use it            |
      | Actions        | Edit, Duplicate, Delete                   |

  Scenario: Create a new AI Tool Set
    Given I am on the AI Tool Sets management page
    When I click "+ New Tool Set"
    Then a creation form should appear with:
      | Field              | Type          | Required |
      | Tool Set Name      | Text input    | Yes      |
      | Description        | Text area     | No       |
      | Tools              | Multi-select  | Yes      |
      | API Configuration  | JSON/Form     | Yes      |
      | Status             | Toggle        | Yes      |

  Scenario: Edit an existing AI Tool Set
    Given I see a tool set named "Financial Analysis Tools"
    When I click "Edit" on that tool set
    Then the edit form should load with current configuration
    And I should be able to modify all fields
    When I save changes
    Then all projects and chats using this tool set should use the updated config

  # ---------- Model Configuration ----------

  Scenario: Navigate to Model Configuration
    When I click the "Model Configuration" card
    Then I should see the model configuration page with:
      | Element               | Description                                  |
      | Available Models      | List of AI models with enable/disable toggles|
      | Default Model         | Dropdown to set the organization default      |
      | Default Temperature   | Slider for organization-wide default temp     |
      | Token Limits          | Max tokens per request configuration          |
      | Rate Limits           | Requests per minute/hour limits               |

  Scenario: Enable or disable an AI model
    Given I see the list of available models
    When I toggle a model from Active to Inactive
    Then the model should no longer appear in user model dropdowns
    And a warning should appear if users currently have it selected
    And existing chats using the model should continue to function

  Scenario: Set organization default model
    Given I am on Model Configuration
    When I change the default model to "ChatGPT"
    And I click "Save"
    Then all new chats should default to "ChatGPT"
    And existing chats should retain their current model selection

  # ---------- System Prompts ----------

  Scenario: Navigate to System Prompts management
    When I click the "System Prompts" card
    Then I should see a list of system prompts:
      | Element           | Description                                   |
      | Prompt Name       | Descriptive name for the prompt               |
      | Prompt Preview    | First 100 characters of the prompt text       |
      | Scope             | Global, Project, or App level                 |
      | Status            | Active/Inactive                               |
      | Last Modified     | Date of last modification                     |

  Scenario: Create a new System Prompt
    Given I am on the System Prompts page
    When I click "+ New System Prompt"
    Then a creation form should appear:
      | Field            | Type          | Required |
      | Prompt Name      | Text input    | Yes      |
      | Prompt Text      | Rich text area| Yes      |
      | Scope            | Dropdown      | Yes      |
      | Status           | Toggle        | Yes      |
    And the prompt text area should support markdown formatting
    And variable placeholders should be supported (e.g., {{user_name}}, {{date}})

  Scenario: Edit a system prompt
    Given a system prompt "Enterprise Default" exists
    When I click "Edit" on that prompt
    Then the editing form should load with the current prompt text
    And I should see a preview of how the prompt will render
    When I modify and save
    Then all chats using this prompt scope should use the updated version

  # ---------- Quick Stats Section ----------

  Scenario: Quick Stats displays key metrics
    Then the Quick Stats section should display cards:
      | Stat Card       | Value Format    | Description                        |
      | Total Users     | Numeric (e.g., 26) | Total registered portal users   |
      | Active Today    | Numeric (e.g., 1)  | Users who logged in today       |
      | Projects        | Numeric (e.g., 15) | Total projects across all users |
    And each stat card should display:
      | Element         | Style                                        |
      | Number          | Large bold Vetted serif typography            |
      | Label           | Smaller sans-serif text below                |
      | Trend Indicator | Arrow up/down with percentage change         |
    And the stat numbers should use the Vetted dark text color

  Scenario: Quick Stats update in real-time
    Given the admin dashboard is displayed
    When user activity changes (new login, new project)
    Then the Quick Stats should update without page refresh
    And the numbers should animate when transitioning

  # ---------- Support Tools Section ----------

  Scenario: Support Tools section displays health monitors
    Then the Support Tools section should display:
      | Tool                   | Description                               |
      | AI Tool Sets Health    | Status of each tool set (operational/down) |
      | Model Health           | Status of AI model endpoints              |
    And each tool should show a status indicator:
      | Status         | Color     | Icon       |
      | Operational    | Green     | Check      |
      | Degraded       | Yellow    | Warning    |
      | Down           | Red       | X          |

  Scenario: AI Tool Sets Health monitoring
    When I click "AI Tool Sets Health"
    Then I should see a detailed view of each tool set:
      | Column              | Description                              |
      | Tool Set Name       | Name of the tool set                    |
      | Status              | Current operational status               |
      | Last Check          | When the health check last ran           |
      | Response Time       | Average response time in ms              |
      | Error Rate          | Percentage of failed requests            |
      | Actions             | Restart, Disable, View Logs              |

  Scenario: Model Health monitoring
    When I click "Model Health"
    Then I should see the status of each AI model:
      | Column           | Description                                 |
      | Model Name       | Name of the AI model                        |
      | Status           | Current availability status                 |
      | Latency          | Current average response latency            |
      | Uptime           | Percentage uptime (30-day rolling)          |
      | Last Error       | Most recent error (if any)                  |

  # ---------- User Management ----------

  Scenario: Admin views user management
    Given I navigate to a "Users" management section from the dashboard
    Then I should see a table of all registered users:
      | Column        | Description                                  |
      | Avatar        | User profile image                           |
      | Name          | Full name                                    |
      | Email         | Email address                                |
      | Role          | Standard User / Admin / Super Admin          |
      | Status        | Active / Inactive / Suspended                |
      | Last Active   | Last login date/time                         |
      | Actions       | Edit Role, Suspend, Delete                   |

  Scenario: Change a user's role
    Given I see a user "John Doe" with role "Standard User"
    When I click "Edit Role" on John's entry
    And I change his role to "Admin"
    And I click "Save"
    Then John's role should be updated to "Admin"
    And John should now see the Admin navigation item on his next login

  Scenario: Suspend a user
    Given I see an active user "Jane Smith"
    When I click "Suspend" on Jane's entry
    Then a confirmation dialog should appear
    When I confirm
    Then Jane's status should change to "Suspended"
    And Jane should be unable to log in until reactivated
    And her active sessions should be terminated

  # ---------- Analytics / Usage (Extended) ----------

  Scenario: View usage analytics
    Given the admin dashboard has an analytics section
    Then I should be able to view:
      | Metric                    | Visualization              |
      | Daily Active Users        | Line chart (30-day trend)  |
      | Total Chats               | Bar chart by day/week      |
      | Model Usage Distribution  | Pie chart by model         |
      | Token Consumption         | Area chart by day          |
      | Top Users by Activity     | Ranked list                |
      | Popular Apps              | Ranked list                |
    And all charts should use the Vetted color palette:
      | Color Usage          | Hex        |
      | Primary Data         | #C4A962    |
      | Secondary Data       | #1A1A1A    |
      | Tertiary Data        | #6B7280    |
      | Background           | #FFFFFF    |
      | Grid Lines           | #F3F4F6    |
