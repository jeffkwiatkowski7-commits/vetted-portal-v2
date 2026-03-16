@authentication @security
Feature: User Authentication and Session Management
  As a Vetted Portal user
  I want to securely authenticate and manage my session
  So that I can access the AI portal with appropriate permissions

  Background:
    Given the Vetted Portal login page is displayed
    And the page follows the Vetted design system:
      | Element             | Style                                              |
      | Background          | Clean white (#FFFFFF)                                |
      | Logo                | "Vetted." black serif font with period               |
      | Primary Button      | Black background (#1A1A1A), white text, rounded      |
      | Secondary Button    | White background, black border, black text, rounded  |
      | Accent Color        | Gold/amber (#C4A962) for highlights and indicators   |
      | Typography Heading  | Serif font, large weight for headlines               |
      | Typography Body     | Sans-serif font, clean and readable                  |
      | Spacing             | Generous whitespace, minimalist enterprise aesthetic  |

  # ---------- SSO Login ----------

  Scenario: Successful SSO login
    Given I am an authorized enterprise user
    When I navigate to the Vetted Portal login URL
    And I authenticate via the enterprise SSO provider
    Then I should be redirected to the main chat interface
    And I should see the sidebar navigation with my user profile
    And the welcome message "Welcome to Vetted AI" should be displayed

  Scenario: SSO login with invalid credentials
    Given I am not an authorized enterprise user
    When I navigate to the Vetted Portal login URL
    And I fail SSO authentication
    Then I should see an error message styled with the Vetted design system
    And I should remain on the login page
    And a "Contact Administrator" link should be displayed

  # ---------- Role-Based Access ----------

  Scenario Outline: Role-based access control on login
    Given I am authenticated as a user with role "<role>"
    When the portal loads
    Then I should see the following navigation items: <nav_items>
    And I should <admin_access> the Admin navigation item

    Examples:
      | role          | nav_items                                    | admin_access |
      | Standard User | New Chat, Projects, Library, Apps            | not see      |
      | Admin         | New Chat, Projects, Library, Apps, Admin     | see          |
      | Super Admin   | New Chat, Projects, Library, Apps, Admin     | see          |

  # ---------- Session Management ----------

  Scenario: Session timeout after inactivity
    Given I am logged into the Vetted Portal
    When I remain inactive for the configured timeout period
    Then I should be automatically logged out
    And I should be redirected to the SSO login page
    And a "Session expired" message should be displayed

  Scenario: Active session persistence
    Given I am logged into the Vetted Portal
    When I refresh the browser page
    Then my session should remain active
    And I should return to my previous view state

  Scenario: Concurrent session handling
    Given I am logged into the Vetted Portal on one device
    When I log in from a second device
    Then both sessions should remain active
    And chat history should sync across sessions

  # ---------- Logout ----------

  Scenario: User logout
    Given I am logged into the Vetted Portal
    When I click the user profile area in the sidebar
    And I select "Sign Out"
    Then I should be logged out of the portal
    And I should be redirected to the SSO login page
    And my session tokens should be invalidated
