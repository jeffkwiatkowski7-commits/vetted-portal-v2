import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { initializeDatabase, dbGet, dbRun } from './database.js';

function getCurrentTimestamp() {
  return new Date().toISOString();
}

export async function seedDatabase() {
  const db = await initializeDatabase();

  // Check if already seeded
  const userCount = dbGet(db, 'SELECT COUNT(*) as count FROM users');
  if (userCount && userCount.count > 0) {
    console.log('Database already seeded. Skipping...');
    return;
  }

  console.log('Seeding database with demo data...');

  const now = getCurrentTimestamp();

  const jeffkPasswordHash = await bcrypt.hash('Vetted@3:16', 10);

  // Seed Users
  const users = [
    {
      id: uuidv4(),
      email: 'jeffk@vettedbot.com',
      display_name: 'Jeff Kwiatkowski',
      job_title: 'Administrator',
      department: 'Admin',
      role: 'admin',
      avatar_path: null,
      status: 'active',
      created_at: now,
      updated_at: now,
      last_login_at: now,
      password_hash: jeffkPasswordHash
    }
  ];

  for (const user of users) {
    dbRun(db, `
      INSERT INTO users (id, email, display_name, job_title, department, role, avatar_path, status, created_at, updated_at, last_login_at, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [user.id, user.email, user.display_name, user.job_title, user.department, user.role, user.avatar_path, user.status, user.created_at, user.updated_at, user.last_login_at, user.password_hash]);
  }

  console.log(`✓ Created ${users.length} users`);

  // Seed Model Configs
  const models = [
    {
      id: 'gemini-3-1-pro',
      model_name: 'Gemini 3.1',
      provider: 'Google',
      display_name: 'Gemini 3.1',
      icon_color: '#3B82F6',
      is_default: 1,
      is_enabled: 1,
      max_tokens: 8192,
      rate_limit: 60,
      created_at: now,
      updated_at: now
    },
    {
      id: 'gemini-3-1-flash',
      model_name: 'Gemini 3.1 Flash',
      provider: 'Google',
      display_name: 'Gemini 3.1 Flash',
      icon_color: '#60A5FA',
      is_default: 0,
      is_enabled: 1,
      max_tokens: 8192,
      rate_limit: 120,
      created_at: now,
      updated_at: now
    },
    {
      id: 'gemini-2-5-flash',
      model_name: 'Gemini 2.5 Flash',
      provider: 'Google',
      display_name: 'Gemini 2.5 Flash',
      icon_color: '#10B981',
      is_default: 0,
      is_enabled: 1,
      max_tokens: 8192,
      rate_limit: 120,
      created_at: now,
      updated_at: now
    }
  ];

  for (const model of models) {
    dbRun(db, `
      INSERT INTO model_configs (id, model_name, provider, display_name, icon_color, is_default, is_enabled, max_tokens, rate_limit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [model.id, model.model_name, model.provider, model.display_name, model.icon_color, model.is_default, model.is_enabled, model.max_tokens, model.rate_limit, model.created_at, model.updated_at]);
  }

  console.log(`✓ Created ${models.length} model configs`);

  // Seed App Categories
  const categories = [
    {
      id: 'analysis',
      name: 'Analysis',
      description: 'Data analysis and insights tools'
    },
    {
      id: 'development',
      name: 'Development',
      description: 'Code development and programming tools'
    },
    {
      id: 'writing',
      name: 'Writing',
      description: 'Content writing and documentation tools'
    },
    {
      id: 'data',
      name: 'Data',
      description: 'Data processing and insights tools'
    }
  ];

  for (const category of categories) {
    dbRun(db, `
      INSERT INTO app_categories (id, name, description)
      VALUES (?, ?, ?)
    `, [category.id, category.name, category.description]);
  }

  console.log(`✓ Created ${categories.length} app categories`);

  // Seed Tool Sets
  const toolSets = [
    {
      id: uuidv4(),
      name: 'Financial Analysis Tools',
      description: 'Tools for financial analysis and reporting',
      tools: JSON.stringify(['ROI Calculator', 'Expense Tracker', 'Forecast Model', 'Budget Analyzer']),
      api_config: JSON.stringify({ endpoint: '/api/financial', auth: 'apikey' }),
      status: 'active',
      usage_count: 342,
      created_at: now,
      updated_at: now
    },
    {
      id: uuidv4(),
      name: 'Code Review Tools',
      description: 'Tools for code review and quality assurance',
      tools: JSON.stringify(['Syntax Checker', 'Performance Analyzer', 'Security Scanner', 'Test Generator']),
      api_config: JSON.stringify({ endpoint: '/api/code-analysis', auth: 'oauth' }),
      status: 'active',
      usage_count: 521,
      created_at: now,
      updated_at: now
    },
    {
      id: uuidv4(),
      name: 'Content Generation Tools',
      description: 'Tools for generating and optimizing content',
      tools: JSON.stringify(['Template Generator', 'SEO Optimizer', 'Grammar Checker', 'Style Guide']),
      api_config: JSON.stringify({ endpoint: '/api/content', auth: 'apikey' }),
      status: 'active',
      usage_count: 287,
      created_at: now,
      updated_at: now
    }
  ];

  for (const toolSet of toolSets) {
    dbRun(db, `
      INSERT INTO tool_sets (id, name, description, tools, api_config, status, usage_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [toolSet.id, toolSet.name, toolSet.description, toolSet.tools, toolSet.api_config, toolSet.status, toolSet.usage_count, toolSet.created_at, toolSet.updated_at]);
  }

  console.log(`✓ Created ${toolSets.length} tool sets`);

  // Seed System Prompts
  const systemPrompts = [
    {
      id: uuidv4(),
      name: 'Enterprise Default',
      prompt_text: 'You are an enterprise AI assistant helping with business decisions and analysis. Be professional, data-driven, and focus on actionable insights.',
      scope: 'enterprise',
      status: 'active',
      created_at: now,
      updated_at: now
    },
    {
      id: uuidv4(),
      name: 'Code Assistant',
      prompt_text: 'You are an expert code assistant. Provide clear, well-documented code examples with explanations. Follow best practices and consider performance.',
      scope: 'development',
      status: 'active',
      created_at: now,
      updated_at: now
    }
  ];

  for (const prompt of systemPrompts) {
    dbRun(db, `
      INSERT INTO system_prompts (id, name, prompt_text, scope, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [prompt.id, prompt.name, prompt.prompt_text, prompt.scope, prompt.status, prompt.created_at, prompt.updated_at]);
  }

  console.log(`✓ Created ${systemPrompts.length} system prompts`);

  // Seed Apps
  const apps = [
    {
      id: uuidv4(),
      name: 'Document Analyzer',
      description: 'Analyze and summarize documents with advanced NLP',
      icon: '📄',
      category: 'analysis',
      system_prompt: systemPrompts[0].id,
      model: 'gemini-3',
      temperature: 0.5,
      tool_sets: JSON.stringify([toolSets[0].id]),
      visibility: 'all',
      status: 'active',
      usage_count: 1247,
      created_by: users[0].id,
      created_at: now,
      updated_at: now
    },
    {
      id: uuidv4(),
      name: 'Code Assistant',
      description: 'Help with code generation and debugging',
      icon: '💻',
      category: 'development',
      system_prompt: systemPrompts[1].id,
      model: 'gemini-3',
      temperature: 0.3,
      tool_sets: JSON.stringify([toolSets[1].id]),
      visibility: 'all',
      status: 'active',
      usage_count: 2156,
      created_by: users[0].id,
      created_at: now,
      updated_at: now
    },
    {
      id: uuidv4(),
      name: 'Content Writer',
      description: 'Generate and edit marketing and technical content',
      icon: '✍️',
      category: 'writing',
      system_prompt: systemPrompts[0].id,
      model: 'gpt-4',
      temperature: 0.8,
      tool_sets: JSON.stringify([toolSets[2].id]),
      visibility: 'all',
      status: 'active',
      usage_count: 876,
      created_by: users[0].id,
      created_at: now,
      updated_at: now
    },
    {
      id: uuidv4(),
      name: 'Data Insights',
      description: 'Extract insights from data and create reports',
      icon: '📊',
      category: 'data',
      system_prompt: systemPrompts[0].id,
      model: 'gemini-pro',
      temperature: 0.4,
      tool_sets: JSON.stringify([toolSets[0].id]),
      visibility: 'all',
      status: 'active',
      usage_count: 654,
      created_by: users[0].id,
      created_at: now,
      updated_at: now
    },
    {
      id: uuidv4(),
      name: 'PowerPoint Template Extractor',
      description: 'Extract design tokens from PowerPoint templates — colors, fonts, backgrounds, and layouts — saved as JSON to your Library for use with Canvas Mode',
      icon: '📊',
      category: 'data',
      system_prompt: systemPrompts[0].id,
      model: 'gemini-3',
      temperature: 0.5,
      tool_sets: JSON.stringify([]),
      visibility: 'all',
      status: 'active',
      usage_count: 0,
      created_by: users[0].id,
      created_at: now,
      updated_at: now
    }
  ];

  for (const app of apps) {
    dbRun(db, `
      INSERT INTO apps (id, name, description, icon, category, system_prompt, model, temperature, tool_sets, visibility, status, usage_count, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [app.id, app.name, app.description, app.icon, app.category, app.system_prompt, app.model, app.temperature, app.tool_sets, app.visibility, app.status, app.usage_count, app.created_by, app.created_at, app.updated_at]);
  }

  console.log(`✓ Created ${apps.length} apps`);

  // Seed Canvas Mode skill
  const canvasSkillId = uuidv4();
  dbRun(db, `
    INSERT INTO skills (id, name, description, instructions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    canvasSkillId,
    'Canvas Mode',
    'Renders AI-generated HTML/CSS as live visual previews in chat',
    `You are in Canvas Mode. When the user requests visual content — pages, reports, dashboards, cards, layouts, or any visual output — generate complete, self-contained HTML with embedded CSS.

Rules:
1. Wrap ALL visual HTML output in a \`\`\`canvas-html code fence (not \`\`\`html)
2. Include all styles in a <style> block — no external stylesheets except Google Fonts via @import
3. Make the output responsive and presentable as a standalone page
4. If design tokens are attached (colors, fonts, backgrounds), use them for all styling decisions
5. When the user asks for revisions, output the complete updated HTML — never a partial diff
6. Keep the HTML clean and well-structured — it may be exported and used directly

The \`\`\`canvas-html fence signals the UI to render your output as a live preview instead of a code block. The user can toggle between the preview and the raw code.`,
    now,
    now
  ]);
  console.log('✓ Created Canvas Mode skill');

  // Seed Projects
  const projects = [];
  const projectNames = [
    'Q2 Product Roadmap',
    'Customer Portal Redesign',
    'Data Pipeline Modernization',
    'Security Audit Initiative',
    'Performance Optimization',
    'Mobile App Development',
    'Analytics Dashboard',
    'API Standardization',
    'Documentation Overhaul',
    'DevOps Infrastructure',
    'Machine Learning Pipeline',
    'Cloud Migration',
    'Customer Feedback System',
    'Compliance Framework',
    'Team Training Program'
  ];

  const projectDescriptions = [
    'Define and track product features for Q2',
    'Modernize customer portal with new UX',
    'Improve data processing efficiency',
    'Comprehensive security assessment',
    'Optimize system performance metrics',
    'Launch iOS and Android applications',
    'Create real-time analytics dashboard',
    'Standardize API design patterns',
    'Update technical documentation',
    'Migrate to cloud infrastructure',
    'Build ML-based recommendation engine',
    'Transition to cloud services',
    'Implement customer feedback collection',
    'Ensure regulatory compliance',
    'Develop team skills and knowledge'
  ];

  for (let i = 0; i < 15; i++) {
    const project = {
      id: uuidv4(),
      owner_id: users[i % users.length].id,
      name: projectNames[i],
      description: projectDescriptions[i],
      default_model: 'gemini-3',
      system_prompt: systemPrompts[0].id,
      temperature: 0.7,
      tool_sets: JSON.stringify([toolSets[i % toolSets.length].id]),
      status: 'active',
      created_at: now,
      updated_at: now
    };
    projects.push(project);
    dbRun(db, `
      INSERT INTO projects (id, owner_id, name, description, default_model, system_prompt, temperature, tool_sets, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [project.id, project.owner_id, project.name, project.description, project.default_model, project.system_prompt, project.temperature, project.tool_sets, project.status, project.created_at, project.updated_at]);
  }

  console.log(`✓ Created ${projects.length} projects`);

  // Seed Project Members
  let memberCount = 0;
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const memberCount_ = 2 + Math.floor(Math.random() * 4);
    for (let j = 0; j < memberCount_; j++) {
      const user = users[(i + j + 1) % users.length];
      if (user.id !== project.owner_id) {
        dbRun(db, `
          INSERT INTO project_members (id, project_id, user_id, permission, created_at)
          VALUES (?, ?, ?, ?, ?)
        `, [uuidv4(), project.id, user.id, Math.random() > 0.5 ? 'editor' : 'viewer', now]);
        memberCount++;
      }
    }
  }

  console.log(`✓ Created ${memberCount} project members`);

  // Seed Chats and Messages
  const chats = [];
  const chatPrompts = [
    'How can we improve our customer retention metrics?',
    'What are the best practices for API design in microservices?',
    'Analyze our Q1 financial performance',
    'Help me write a project proposal',
    'Can you review this code snippet?',
    'What trends are emerging in our market?',
    'How should we structure our database?',
    'Summarize the latest industry report'
  ];

  let messageCount = 0;

  for (let i = 0; i < 8; i++) {
    const chat = {
      id: uuidv4(),
      user_id: users[i % users.length].id,
      project_id: projects[i % projects.length].id,
      title: chatPrompts[i],
      model: models[i % models.length].model_name,
      temperature: 0.7,
      system_prompt: systemPrompts[0].id,
      is_shared: 0,
      created_at: now,
      updated_at: now
    };
    chats.push(chat);

    dbRun(db, `
      INSERT INTO chats (id, user_id, project_id, title, model, temperature, system_prompt, is_shared, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [chat.id, chat.user_id, chat.project_id, chat.title, chat.model, chat.temperature, chat.system_prompt, chat.is_shared, chat.created_at, chat.updated_at]);

    // Add initial user message
    const userMessage = {
      id: uuidv4(),
      chat_id: chat.id,
      role: 'user',
      content: chatPrompts[i],
      model_used: chat.model,
      token_count: 15 + Math.floor(Math.random() * 20),
      reasoning: null,
      attachments: null,
      created_at: now
    };

    dbRun(db, `
      INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [userMessage.id, userMessage.chat_id, userMessage.role, userMessage.content, userMessage.model_used, userMessage.token_count, userMessage.reasoning, userMessage.attachments, userMessage.created_at]);
    messageCount++;

    // Add AI response
    const aiMessages = [
      'Based on industry data, improving customer retention requires a multi-faceted approach focusing on personalization, proactive support, and value demonstration. Key metrics to track include NPS, churn rate, and customer lifetime value.',
      'In microservices architecture, API design should follow RESTful principles with proper versioning, comprehensive documentation, and clear error handling. Consider using API gateways for routing and security.',
      'Q1 results show a 12% increase in revenue with improved operational efficiency. Marketing spend generated 3.2x ROI. Cost management remained on target with 8% reduction in overhead.',
      'Here\'s a structured project proposal framework: Executive Summary, Objectives, Scope, Timeline, Budget, Success Criteria, and Risk Management. Each section should be clear and measurable.',
      'The code shows good structure. Recommendations: add input validation, implement error handling for edge cases, and consider extracting the transformation logic into a separate utility function.',
      'Market trends indicate increased adoption of AI-powered analytics, growing focus on sustainability, and shift toward subscription models. Our positioning aligns well with these trends.',
      'For optimal database structure, use normalized tables with proper indexing. Consider your query patterns early and implement caching strategies for frequently accessed data.',
      'The report highlights key insights on digital transformation, remote work sustainability, and emerging technologies. Main takeaway: companies embracing AI early gain competitive advantage.'
    ];

    const aiResponse = {
      id: uuidv4(),
      chat_id: chat.id,
      role: 'assistant',
      content: aiMessages[i],
      model_used: chat.model,
      token_count: 50 + Math.floor(Math.random() * 150),
      reasoning: JSON.stringify({
        thinking: [
          { step: 'Understanding', content: 'Analyzing the user request' },
          { step: 'Planning', content: 'Structuring comprehensive response' },
          { step: 'Execution', content: 'Generating detailed answer' }
        ]
      }),
      attachments: null,
      created_at: now
    };

    dbRun(db, `
      INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [aiResponse.id, aiResponse.chat_id, aiResponse.role, aiResponse.content, aiResponse.model_used, aiResponse.token_count, aiResponse.reasoning, aiResponse.attachments, aiResponse.created_at]);
    messageCount++;

    // Add follow-up exchange
    const followUpQuestions = [
      'Can you provide specific examples?',
      'What about security considerations?',
      'How do we measure success?',
      'What\'s the timeline?',
      'What are the costs involved?',
      'How does this compare to alternatives?',
      'What are potential risks?',
      'Who should be involved?'
    ];

    const followUpResponse = {
      id: uuidv4(),
      chat_id: chat.id,
      role: 'user',
      content: followUpQuestions[i],
      model_used: chat.model,
      token_count: 8 + Math.floor(Math.random() * 10),
      reasoning: null,
      attachments: null,
      created_at: now
    };

    dbRun(db, `
      INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [followUpResponse.id, followUpResponse.chat_id, followUpResponse.role, followUpResponse.content, followUpResponse.model_used, followUpResponse.token_count, followUpResponse.reasoning, followUpResponse.attachments, followUpResponse.created_at]);
    messageCount++;

    // Add follow-up response
    const followUpResponses = [
      'Specific examples include: personalized email campaigns, proactive customer success calls, and loyalty rewards programs. Companies using these strategies see 25-35% improvement in retention.',
      'Security is paramount. Implement OAuth2 for authentication, use HTTPS exclusively, add rate limiting, and include comprehensive input validation. Regular security audits are recommended.',
      'Success metrics should include KPIs like: adoption rate (target: 60% within 6 months), user satisfaction (target: 4.5/5), and ROI (target: 2.5x within 12 months).',
      'Timeline: Requirements gathering (2 weeks), design (3 weeks), development (8 weeks), testing (2 weeks), deployment (1 week). Total: 16 weeks.',
      'Budget breakdown: Personnel 60%, Tools & Infrastructure 20%, External Services 15%, Contingency 5%. Total estimated cost: $250,000.',
      'Our solution offers superior performance (40% faster), better pricing (20% lower), and enhanced features (15 additional capabilities) compared to competitors.',
      'Key risks: resource availability, scope creep, and technical challenges. Mitigation: dedicated team, change control process, and technical proof of concepts.',
      'Core team should include: project manager, technical lead, 2 developers, 1 designer, and stakeholder representatives. Total team size: 6-8 people.'
    ];

    const finalResponse = {
      id: uuidv4(),
      chat_id: chat.id,
      role: 'assistant',
      content: followUpResponses[i],
      model_used: chat.model,
      token_count: 40 + Math.floor(Math.random() * 120),
      reasoning: JSON.stringify({
        thinking: [
          { step: 'Context Understanding', content: 'Processing follow-up question' },
          { step: 'Detailed Analysis', content: 'Providing specific information' }
        ]
      }),
      attachments: null,
      created_at: now
    };

    dbRun(db, `
      INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [finalResponse.id, finalResponse.chat_id, finalResponse.role, finalResponse.content, finalResponse.model_used, finalResponse.token_count, finalResponse.reasoning, finalResponse.attachments, finalResponse.created_at]);
    messageCount++;
  }

  console.log(`✓ Created ${chats.length} chats with ${messageCount} messages`);

  // Seed Library Files
  const libraryFiles = [
    {
      id: uuidv4(),
      user_id: users[0].id,
      filename: 'q1-financial-report-2024.pdf',
      original_name: 'Q1 Financial Report 2024.pdf',
      file_path: '/library/q1-financial-report-2024.pdf',
      file_type: 'pdf',
      file_size: 2456789,
      mime_type: 'application/pdf',
      project_id: projects[0].id,
      uploaded_at: now
    },
    {
      id: uuidv4(),
      user_id: users[0].id,
      filename: 'api-design-guidelines.docx',
      original_name: 'API Design Guidelines.docx',
      file_path: '/library/api-design-guidelines.docx',
      file_type: 'docx',
      file_size: 1234567,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      project_id: projects[3].id,
      uploaded_at: now
    },
    {
      id: uuidv4(),
      user_id: users[0].id,
      filename: 'customer-data-analysis.xlsx',
      original_name: 'Customer Data Analysis.xlsx',
      file_path: '/library/customer-data-analysis.xlsx',
      file_type: 'xlsx',
      file_size: 3456789,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      project_id: projects[1].id,
      uploaded_at: now
    },
    {
      id: uuidv4(),
      user_id: users[0].id,
      filename: 'ui-design-system.fig',
      original_name: 'UI Design System.fig',
      file_path: '/library/ui-design-system.fig',
      file_type: 'fig',
      file_size: 4567890,
      mime_type: 'application/x-figma-document',
      project_id: projects[2].id,
      uploaded_at: now
    },
    {
      id: uuidv4(),
      user_id: users[0].id,
      filename: 'marketing-campaign-brief.pptx',
      original_name: 'Marketing Campaign Brief.pptx',
      file_path: '/library/marketing-campaign-brief.pptx',
      file_type: 'pptx',
      file_size: 5678901,
      mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      project_id: projects[4].id,
      uploaded_at: now
    }
  ];

  for (const file of libraryFiles) {
    dbRun(db, `
      INSERT INTO library_files (id, user_id, filename, original_name, file_path, file_type, file_size, mime_type, project_id, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [file.id, file.user_id, file.filename, file.original_name, file.file_path, file.file_type, file.file_size, file.mime_type, file.project_id, file.uploaded_at]);
  }

  console.log(`✓ Created ${libraryFiles.length} library files`);

  // Seed User Preferences
  for (const user of users.slice(0, 6)) {
    dbRun(db, `
      INSERT INTO user_preferences (id, user_id, default_model, default_temperature, show_reasoning, auto_scroll, compact_view, code_theme, notify_shared_chat, notify_project_updates, notify_system, notify_weekly_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      user.id,
      'gemini-3',
      0.7,
      user.role === 'admin' ? 1 : 0,
      1,
      0,
      'light',
      1,
      1,
      1,
      user.role === 'admin' ? 1 : 0
    ]);
  }

  console.log(`✓ Created ${users.length} user preferences`);

  // Seed Notifications
  const notifications = [
    {
      id: uuidv4(),
      user_id: users[0].id,
      type: 'project_update',
      title: 'Project Updated',
      description: 'Q2 Product Roadmap has been updated',
      link: `/projects/${projects[0].id}`,
      is_read: 0,
      created_at: now
    },
    {
      id: uuidv4(),
      user_id: users[0].id,
      type: 'chat_shared',
      title: 'Chat Shared',
      description: 'A chat has been shared with you',
      link: `/chats/${chats[0].id}`,
      is_read: 0,
      created_at: now
    },
    {
      id: uuidv4(),
      user_id: users[0].id,
      type: 'system',
      title: 'System Maintenance',
      description: 'Scheduled maintenance completed successfully',
      link: null,
      is_read: 1,
      created_at: now
    },
    {
      id: uuidv4(),
      user_id: users[0].id,
      type: 'team_mention',
      title: 'You were mentioned',
      description: 'You were mentioned in a project comment',
      link: `/projects/${projects[1].id}`,
      is_read: 0,
      created_at: now
    }
  ];

  for (const notification of notifications) {
    dbRun(db, `
      INSERT INTO notifications (id, user_id, type, title, description, link, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [notification.id, notification.user_id, notification.type, notification.title, notification.description, notification.link, notification.is_read, notification.created_at]);
  }

  console.log(`✓ Created ${notifications.length} notifications`);

  console.log('\n✅ Database seeding completed successfully!');
}
