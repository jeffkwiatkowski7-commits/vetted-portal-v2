@library @files
Feature: Library and File Management
  As a Vetted Portal user
  I want to manage my uploaded files in a central library
  So that I can organize, search, and reference files across chats and projects

  Background:
    Given I am authenticated and on the Vetted Portal
    And I have navigated to the Library page via the sidebar

  # ---------- Library Page Layout ----------

  Scenario: Library page displays with correct layout
    Then the Library page should display:
      | Element                | Description                                           |
      | Page Header            | "Library" in Vetted serif typography                  |
      | Search Bar             | Search input with "Search files..." placeholder       |
      | Upload Button          | "+ Upload" button in Vetted primary style (black)     |
      | Storage Meter          | Visual indicator showing used vs. total storage       |
      | File List              | Table/list of uploaded files                          |
      | Bulk Actions Bar       | Appears when files are selected via checkboxes        |
    And the layout should follow Vetted's clean white design with generous spacing

  # ---------- Storage Meter ----------

  Scenario: Storage meter displays usage information
    Given my account has uploaded files totaling 261.8 KB
    And my storage limit is configured by the admin
    Then the storage meter should display:
      | Element           | Value                                    |
      | Used Storage      | "261.8 KB" (human-readable format)       |
      | Total Files       | "3 files" (count of uploaded files)       |
      | Progress Bar      | Visual bar showing percentage used        |
    And the progress bar should use gold/amber (#C4A962) fill
    And if storage exceeds 80%, the bar should change to a warning color
    And if storage exceeds 95%, the bar should change to red

  # ---------- File List ----------

  Scenario: File list displays all uploaded files
    Given I have uploaded files to my library
    Then the file list should display a table with columns:
      | Column         | Description                                    |
      | Checkbox       | Selection checkbox for bulk actions             |
      | File Icon      | Icon representing the file type                 |
      | File Name      | Name of the file (clickable)                   |
      | File Type      | Extension or type label (PDF, DOCX, etc.)      |
      | File Size      | Human-readable size (KB, MB)                   |
      | Date Uploaded   | Relative time (e.g., "2 days ago")            |
      | Actions        | Overflow menu (...) for file actions           |

  Scenario: File type icons are displayed correctly
    Then each file should display the appropriate type icon:
      | Extension | Icon Style                          |
      | .pdf      | Red/amber PDF icon                  |
      | .docx     | Blue Word document icon             |
      | .xlsx     | Green spreadsheet icon              |
      | .csv      | Table/grid icon                     |
      | .txt      | Plain text document icon            |
      | .png/.jpg | Image thumbnail or image icon       |

  Scenario: File list sorting
    Given the file list is displayed
    When I click on a column header (e.g., "File Name")
    Then the list should sort by that column ascending
    When I click the same column header again
    Then the list should sort by that column descending
    And a sort direction indicator (arrow) should be displayed

  # ---------- File Upload ----------

  Scenario: Upload a single file
    When I click "+ Upload"
    Then a file picker dialog should open
    When I select a file "quarterly_report.pdf" (150 KB)
    Then an upload progress indicator should appear
    And when upload completes, the file should appear in the file list
    And the storage meter should update to reflect the new total
    And a success toast notification should appear

  Scenario: Upload multiple files simultaneously
    When I click "+ Upload"
    And I select multiple files
    Then each file should show individual upload progress
    And all files should appear in the list when uploads complete
    And the storage meter should update with the combined new total

  Scenario: Drag and drop file upload
    When I drag files over the Library page
    Then a drop zone overlay should appear with Vetted styling
    And the overlay should display "Drop files to upload"
    When I drop the files
    Then they should begin uploading with progress indicators

  Scenario: Upload file exceeding size limit
    Given the maximum file size is configured to 50 MB
    When I try to upload a file larger than 50 MB
    Then the upload should be rejected
    And an error message should display: "File exceeds maximum size of 50 MB"

  Scenario: Upload unsupported file type
    Given only specific file types are allowed
    When I try to upload an unsupported file type (e.g., .exe)
    Then the upload should be rejected
    And an error message should display the supported file types

  # ---------- File Actions ----------

  Scenario: Preview a file
    Given a file "report.pdf" exists in my library
    When I click on the file name
    Then a file preview panel or modal should open
    And the preview should display the file content (rendered for supported types)
    And a "Download" button should be available in the preview

  Scenario: Download a file
    Given a file exists in my library
    When I click the actions menu (...) on the file
    And I select "Download"
    Then the file should begin downloading to my computer

  Scenario: Rename a file
    Given a file "old_name.pdf" exists in my library
    When I click the actions menu and select "Rename"
    Then the file name should become an editable text field
    When I type "new_name.pdf" and press Enter
    Then the file should be renamed in the library

  Scenario: Delete a single file
    Given a file exists in my library
    When I click the actions menu and select "Delete"
    Then a confirmation dialog should appear:
      | Element     | Content                                          |
      | Title       | "Delete file?"                                   |
      | Message     | "This action cannot be undone."                  |
      | Cancel      | Secondary button                                 |
      | Delete      | Red/danger styled button                         |
    When I confirm deletion
    Then the file should be removed from the library
    And the storage meter should update accordingly

  # ---------- Bulk Actions ----------

  Scenario: Select multiple files for bulk action
    Given the file list is displayed
    When I check the checkboxes on multiple files
    Then a bulk actions bar should appear at the top of the list
    And it should show the count of selected files
    And available bulk actions:
      | Action     | Description                    |
      | Download   | Download selected as ZIP       |
      | Delete     | Delete all selected files      |
      | Move       | Move to a project              |

  Scenario: Select all files
    When I check the "Select All" checkbox in the header row
    Then all files on the current page should be selected
    And the bulk actions bar should show the total count

  # ---------- File Search ----------

  Scenario: Search files by name
    Given I have multiple files in my library
    When I type "report" in the search bar
    Then only files containing "report" in the name should be displayed
    And the search should be case-insensitive
    And results should update as I type (debounced 300ms)

  Scenario: Search returns no results
    When I search for a term that matches no files
    Then an empty state should display "No files found"
    And a suggestion to "Upload a file" should be shown

  # ---------- File Usage in Chats ----------

  Scenario: Reference a library file in a chat
    Given I am in an active chat
    When I want to reference a file from my library
    Then I should be able to browse or search my library from the chat
    And selecting a file should attach it to the current prompt
    And the file content should be included as context for the AI
