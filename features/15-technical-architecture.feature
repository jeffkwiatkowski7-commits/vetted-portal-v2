@technical @architecture @database @storage @demo-infrastructure
Feature: Technical Architecture - SQLite, Local Storage, and Mock Models
  As a developer building the Vetted Portal demo
  I want clearly defined technical constraints for the demonstration build
  So that the portal runs locally without external dependencies

  Background:
    Given this portal is being built for demonstration purposes
    And all data persistence uses local SQLite
    And file uploads use local filesystem storage
    And AI model integrations are mocked (non-functional)

  # ============================================================
  # SECTION 1: LOCAL SQLITE DATABASE
  # ============================================================

  @database @sqlite
  Scenario: SQLite database is initialized on first launch
    Given the portal application starts for the first time
    When the database initialization runs
    Then a SQLite database file should be created at "./data/vetted_portal.db"
    And the following tables should be created:

      | Table Name          | Purpose                                         |
      | users               | User accounts and profiles                      |
      | sessions            | Active user sessions                            |
      | chats               | Chat conversations                              |
      | messages            | Individual chat messages (user + AI)             |
      | projects            | Project metadata                                |
      | project_members     | Project sharing and permissions                 |
      | project_files       | Files associated with projects                  |
      | library_files       | User library file metadata                      |
      | apps                | Custom AI app configurations                    |
      | app_categories      | App category definitions                        |
      | tool_sets           | AI tool set configurations                      |
      | system_prompts      | System-level prompt templates                   |
      | model_configs       | AI model configuration and defaults             |
      | api_keys            | User personal API keys                          |
      | notifications       | In-app notifications                            |
      | user_preferences    | User-level preference settings                  |
      | audit_log           | Action audit trail                              |
      | demo_data           | Pre-seeded data for demo mode                   |

  @database @sqlite
  Scenario: Users table schema
    Then the "users" table should have the following columns:
      | Column         | Type         | Constraints                    |
      | id             | TEXT         | PRIMARY KEY (UUID)             |
      | email          | TEXT         | UNIQUE, NOT NULL               |
      | display_name   | TEXT         | NOT NULL                       |
      | job_title      | TEXT         | NULLABLE                       |
      | department     | TEXT         | NULLABLE                       |
      | role           | TEXT         | NOT NULL, DEFAULT 'user'       |
      | avatar_path    | TEXT         | NULLABLE                       |
      | status         | TEXT         | NOT NULL, DEFAULT 'active'     |
      | created_at     | DATETIME     | NOT NULL, DEFAULT CURRENT_TIMESTAMP |
      | updated_at     | DATETIME     | NOT NULL                       |
      | last_login_at  | DATETIME     | NULLABLE                       |
    And role values should be constrained to: 'user', 'admin', 'super_admin'
    And status values should be constrained to: 'active', 'inactive', 'suspended'

  @database @sqlite
  Scenario: Chats table schema
    Then the "chats" table should have the following columns:
      | Column          | Type         | Constraints                    |
      | id              | TEXT         | PRIMARY KEY (UUID)             |
      | user_id         | TEXT         | FOREIGN KEY -> users.id        |
      | project_id      | TEXT         | NULLABLE, FOREIGN KEY -> projects.id |
      | title           | TEXT         | NOT NULL                       |
      | model           | TEXT         | NOT NULL                       |
      | temperature     | REAL         | NOT NULL, DEFAULT 0.7          |
      | system_prompt   | TEXT         | NULLABLE                       |
      | is_shared       | INTEGER      | NOT NULL, DEFAULT 0            |
      | created_at      | DATETIME     | NOT NULL                       |
      | updated_at      | DATETIME     | NOT NULL                       |

  @database @sqlite
  Scenario: Messages table schema
    Then the "messages" table should have the following columns:
      | Column          | Type         | Constraints                    |
      | id              | TEXT         | PRIMARY KEY (UUID)             |
      | chat_id         | TEXT         | FOREIGN KEY -> chats.id        |
      | role            | TEXT         | NOT NULL ('user' or 'assistant') |
      | content         | TEXT         | NOT NULL                       |
      | model_used      | TEXT         | NULLABLE                       |
      | token_count     | INTEGER      | NULLABLE                       |
      | reasoning       | TEXT         | NULLABLE (model reasoning data)|
      | attachments     | TEXT         | NULLABLE (JSON array of file refs) |
      | created_at      | DATETIME     | NOT NULL                       |

  @database @sqlite
  Scenario: Projects table schema
    Then the "projects" table should have the following columns:
      | Column          | Type         | Constraints                    |
      | id              | TEXT         | PRIMARY KEY (UUID)             |
      | owner_id        | TEXT         | FOREIGN KEY -> users.id        |
      | name            | TEXT         | NOT NULL                       |
      | description     | TEXT         | NULLABLE                       |
      | default_model   | TEXT         | NOT NULL                       |
      | system_prompt   | TEXT         | NULLABLE                       |
      | temperature     | REAL         | DEFAULT 0.7                    |
      | tool_sets       | TEXT         | NULLABLE (JSON array of IDs)   |
      | status          | TEXT         | DEFAULT 'active'               |
      | created_at      | DATETIME     | NOT NULL                       |
      | updated_at      | DATETIME     | NOT NULL                       |

  @database @sqlite
  Scenario: Library files table schema
    Then the "library_files" table should have the following columns:
      | Column          | Type         | Constraints                    |
      | id              | TEXT         | PRIMARY KEY (UUID)             |
      | user_id         | TEXT         | FOREIGN KEY -> users.id        |
      | filename        | TEXT         | NOT NULL                       |
      | original_name   | TEXT         | NOT NULL                       |
      | file_path       | TEXT         | NOT NULL                       |
      | file_type       | TEXT         | NOT NULL                       |
      | file_size       | INTEGER      | NOT NULL (bytes)               |
      | mime_type       | TEXT         | NOT NULL                       |
      | project_id      | TEXT         | NULLABLE, FOREIGN KEY          |
      | uploaded_at     | DATETIME     | NOT NULL                       |

  @database @sqlite
  Scenario: Database is pre-seeded with demo data on initialization
    When the database is first created
    Then it should be pre-seeded with the following demo data:
      | Data                    | Count | Details                                          |
      | Demo Admin User         | 1     | "Admin User", admin role, admin@vetted.com       |
      | Demo Standard Users     | 5     | Various names, standard user role                |
      | Sample Projects         | 3     | With descriptions, tool sets, model configs      |
      | Sample Chats            | 8     | Spread across projects and standalone            |
      | Sample Messages         | 40+   | Realistic Q&A pairs with formatted responses     |
      | Sample Library Files    | 5     | Placeholder files with metadata                  |
      | Sample Apps             | 4     | Pre-configured apps (Analyzer, Writer, etc.)     |
      | Sample Tool Sets        | 3     | Pre-configured tool set definitions              |
      | Sample System Prompts   | 2     | Default and project-specific prompts             |
      | Model Configurations    | 3     | Claude, ChatGPT, Gemini configs                  |
      | Quick Stats Seed        | --    | Total Users: 26, Active: 8, Projects: 15        |

  @database @sqlite
  Scenario: SQLite performance configuration
    When the database connection is established
    Then the following SQLite pragmas should be set:
      | Pragma               | Value    | Purpose                           |
      | journal_mode         | WAL      | Better concurrent read/write      |
      | synchronous          | NORMAL   | Balance speed and safety          |
      | cache_size           | -64000   | 64MB cache                        |
      | foreign_keys         | ON       | Enforce foreign key constraints   |
      | busy_timeout         | 5000     | 5 second busy timeout             |

  # ============================================================
  # SECTION 2: LOCAL FILE UPLOAD & STORAGE
  # ============================================================

  @storage @file-upload
  Scenario: Local file storage directory structure
    Given the portal application is running
    Then the following local directory structure should exist:
      | Path                          | Purpose                              |
      | ./data/                       | Root data directory                  |
      | ./data/vetted_portal.db       | SQLite database file                 |
      | ./data/uploads/               | Root uploads directory               |
      | ./data/uploads/library/       | User library file storage            |
      | ./data/uploads/projects/      | Project-specific file storage        |
      | ./data/uploads/avatars/       | User profile photo storage           |
      | ./data/uploads/temp/          | Temporary upload staging             |
    And directories should be created automatically on first launch

  @storage @file-upload
  Scenario: File upload via local filesystem
    Given a user uploads a file through the portal
    When the file is received by the server
    Then the file should be processed as follows:
      | Step | Action                                                       |
      | 1    | Validate file type against allowed extensions                |
      | 2    | Validate file size against maximum limit (50 MB default)     |
      | 3    | Generate a unique filename: {uuid}_{original_filename}       |
      | 4    | Save file to appropriate directory (library/ or projects/)   |
      | 5    | Create a metadata record in library_files or project_files   |
      | 6    | Return file metadata (id, name, size, path) to the client    |

  @storage @file-upload
  Scenario: Allowed file types for upload
    Then the following file types should be accepted:
      | Extension | MIME Type                                           | Category  |
      | .pdf      | application/pdf                                     | Document  |
      | .docx     | application/vnd.openxmlformats-officedocument...    | Document  |
      | .xlsx     | application/vnd.openxmlformats-officedocument...    | Spreadsheet|
      | .csv      | text/csv                                            | Data      |
      | .txt      | text/plain                                          | Text      |
      | .png      | image/png                                           | Image     |
      | .jpg      | image/jpeg                                          | Image     |
      | .jpeg     | image/jpeg                                          | Image     |
      | .json     | application/json                                    | Data      |
      | .md       | text/markdown                                       | Document  |
    And any file type not in this list should be rejected with an error message

  @storage @file-upload
  Scenario: File download serves from local storage
    Given a file exists in "./data/uploads/library/{uuid}_report.pdf"
    When a user requests to download the file
    Then the server should stream the file from local disk
    And set appropriate Content-Type and Content-Disposition headers
    And the original filename should be used for the download

  @storage @file-upload
  Scenario: File deletion removes from local storage
    Given a user deletes a file from the Library
    When the delete is confirmed
    Then the file should be removed from the local filesystem
    And the metadata record should be deleted from SQLite
    And the storage meter should recalculate from remaining files

  @storage @file-upload
  Scenario: Storage meter calculates from local files
    Given the library contains files totaling 261.8 KB
    When the storage meter is rendered
    Then the total should be calculated by summing file_size from library_files table
    And the file count should be a COUNT query on library_files for the user
    And the display format should be human-readable (KB, MB, GB)

  @storage @file-upload
  Scenario: Pre-seeded demo files exist on disk
    When the portal initializes for the first time
    Then sample files should be created in "./data/uploads/library/":
      | Filename                    | Size   | Content                           |
      | {uuid}_quarterly_report.pdf | ~150KB | Placeholder PDF with sample text  |
      | {uuid}_financial_data.xlsx  | ~85KB  | Placeholder spreadsheet           |
      | {uuid}_meeting_notes.txt    | ~27KB  | Sample meeting notes text         |
      | {uuid}_strategy_deck.pdf    | ~200KB | Placeholder strategy document     |
      | {uuid}_team_photo.png       | ~50KB  | Placeholder image                 |

  # ============================================================
  # SECTION 3: MOCK AI MODEL INTEGRATIONS
  # ============================================================

  @models @mock
  Scenario: Three AI models are listed but non-functional
    Given the model configuration exists in SQLite
    Then the following models should be available in the model selector:
      | Model Name    | Provider   | Display Icon | Status          |
      | Claude        | Anthropic  | Purple/AI    | Mock (Demo)     |
      | ChatGPT       | OpenAI     | Green/AI     | Mock (Demo)     |
      | Gemini        | Google     | Blue/AI      | Mock (Demo)     |
    And each model should appear in the dropdown with its name and icon
    And the default selected model should be "Claude"

  @models @mock
  Scenario: Model selector shows all three models
    When I click the model dropdown in the chat interface
    Then I should see three options:
      | Option    | Description                                       |
      | Claude    | "Anthropic's Claude AI model"                     |
      | ChatGPT   | "OpenAI's ChatGPT model"                          |
      | Gemini    | "Google's Gemini AI model"                        |
    And each option should have a distinct provider icon
    And the selected model name should display in the chat header

  @models @mock
  Scenario: Selecting a model stores the preference but does not call an API
    When I select "Gemini" from the model dropdown
    Then the model selector should update to show "Gemini"
    And the chat record in SQLite should store model = "gemini"
    And NO external API call should be made
    And the processing pipeline step should show "Calling Gemini" when a prompt is submitted

  @models @mock
  Scenario: Mock AI response is returned for submitted prompts
    Given the models are non-functional (demo mode)
    When I submit a prompt
    Then the processing pipeline should animate through all 6 steps with realistic timing:
      | Step                    | Simulated Duration |
      | Resolving chat          | 0.1 - 0.3s        |
      | Discovering tools       | 0.2 - 0.5s        |
      | Loading history         | 0.1 - 0.3s        |
      | Building prompt         | 0.3 - 0.6s        |
      | Calling [Model Name]    | 0.5 - 1.5s        |
      | Streaming response      | 2.0 - 5.0s        |
    And a pre-written mock response should be streamed token-by-token
    And the response should be contextually appropriate (matched by keyword)

  @models @mock
  Scenario: Mock responses are varied and contextually relevant
    Then the mock response engine should maintain a library of sample responses:
      | Prompt Keyword Match   | Response Category                              |
      | "analyze", "analysis"  | Returns a structured analysis with bullet points|
      | "summarize", "summary" | Returns a concise summary paragraph             |
      | "write", "draft"       | Returns formatted written content               |
      | "code", "function"     | Returns a code block with explanation            |
      | "compare", "versus"    | Returns a comparison table                       |
      | "list", "top"          | Returns a numbered list                          |
      | (default/no match)     | Returns a generic helpful response               |
    And each response should include markdown formatting (headers, bold, lists)
    And responses should mention the selected model name naturally

  @models @mock
  Scenario: Mock Model Reasoning data is generated
    When a mock response is generated
    Then mock reasoning data should also be generated:
      | Reasoning Step          | Sample Content                              |
      | Understanding           | "The user is asking about [topic]..."       |
      | Planning                | "I'll structure my response as..."          |
      | Key Considerations      | "Important factors include..."              |
      | Response Strategy       | "I'll provide a [format] covering..."       |
    And this reasoning should be viewable in the expandable "Model Reasoning" section

  @models @mock
  Scenario: Admin Model Configuration reflects mock status
    Given I am on the Admin > Model Configuration page
    Then each model should show:
      | Column           | Value                                        |
      | Model Name       | Claude / ChatGPT / Gemini                    |
      | Status           | "Demo Mode" badge in gold/amber              |
      | API Connected    | "Not Connected" with gray indicator          |
      | Default          | Radio button (Claude selected by default)    |
    And a banner should display: "Models are in demo mode. Connect API keys to enable live responses."

  @models @mock
  Scenario: Admin Model Health shows simulated healthy status
    Given I am viewing the Model Health support tool
    Then all three models should show:
      | Model    | Status       | Latency   | Uptime |
      | Claude   | Operational  | ~120ms    | 99.9%  |
      | ChatGPT  | Operational  | ~180ms    | 99.7%  |
      | Gemini   | Operational  | ~150ms    | 99.8%  |
    And a note should indicate "Simulated health data — demo mode"

  # ============================================================
  # SECTION 4: DEMO-SPECIFIC CONFIGURATION
  # ============================================================

  @demo @configuration
  Scenario: Application environment configuration
    Then the application should support the following environment variables:
      | Variable               | Default              | Description                        |
      | DATABASE_PATH          | ./data/vetted_portal.db | SQLite database file path       |
      | UPLOAD_DIR             | ./data/uploads       | Local file storage root            |
      | MAX_FILE_SIZE_MB       | 50                   | Maximum upload file size           |
      | DEFAULT_MODEL          | claude               | Default AI model selection         |
      | DEMO_MODE              | true                 | Enable demo/mock mode              |
      | SEED_DEMO_DATA         | true                 | Pre-seed database on first run     |
      | PORT                   | 3000                 | Application server port            |
      | SESSION_SECRET         | (generated)          | Session encryption secret          |

  @demo @configuration
  Scenario: Demo mode flag controls mock behavior
    Given DEMO_MODE is set to "true"
    Then all AI model calls should return mock responses
    And the processing pipeline should use simulated timing
    And the "Play Demo" walkthrough button should be visible
    And model health should show simulated data
    And a subtle "Demo Mode" badge should appear in the portal footer

  @demo @configuration
  Scenario: Demo mode can be disabled for production
    Given DEMO_MODE is set to "false"
    Then the portal should attempt real API calls to configured models
    And the "Play Demo" button should be hidden
    And model health should report real endpoint status
    And the "Demo Mode" footer badge should not appear
