let isTranslating = false;
let translatedNodes = new Set();
let currentSettings = {};
// WeakMap to store original text without polluting DOM
const originalTextMap = new WeakMap();
// Cache for computed styles to improve performance
const computedStyleCache = new WeakMap();

// RTL languages list
const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur', 'yi', 'ji', 'iw', 'ku', 'ms', 'ml'];

// Loading indicator functions
function createLoadingIndicator() {
    if (loadingIndicator) return;
    
    // Get loading text based on interface language
    const loadingTexts = {
        'en': 'Translating...',
        'zh-CN': '正在翻译...',
        'zh-TW': '正在翻譯...',
        'ja': '翻訳中...',
        'ko': '번역 중...',
        'es': 'Traduciendo...',
        'fr': 'Traduction...',
        'de': 'Übersetzen...',
        'ru': 'Перевод...',
        'ar': 'جارٍ الترجمة...'
    };
    
    const interfaceLang = currentSettings.interfaceLanguage || 'en';
    const loadingText = loadingTexts[interfaceLang] || loadingTexts['en'];
    
    loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'ultra-translate-loading';
    loadingIndicator.innerHTML = `
        <div class="ultra-translate-loading-content">
            <div class="ultra-translate-spinner"></div>
            <div class="ultra-translate-loading-text">
                <span class="ultra-translate-loading-title">${loadingText}</span>
                <span class="ultra-translate-loading-progress">0%</span>
            </div>
            <div class="ultra-translate-loading-bar">
                <div class="ultra-translate-loading-bar-fill"></div>
            </div>
        </div>
    `;
    document.body.appendChild(loadingIndicator);
}

function updateLoadingProgress(current, total) {
    if (!loadingIndicator) return;
    
    const percent = Math.round((current / total) * 100);
    const progressText = loadingIndicator.querySelector('.ultra-translate-loading-progress');
    const progressBar = loadingIndicator.querySelector('.ultra-translate-loading-bar-fill');
    
    if (progressText) progressText.textContent = `${percent}%`;
    if (progressBar) progressBar.style.width = `${percent}%`;
}

function removeLoadingIndicator() {
    if (loadingIndicator) {
        loadingIndicator.remove();
        loadingIndicator = null;
    }
}

let loadingIndicator = null;

chrome.storage.sync.get({
    translationApi: 'google',
    apiKey: '',
    targetLanguage: 'zh-CN',
    preserveOriginal: true,
    autoTranslate: false,
    interfaceLanguage: 'en',
    autoPromptTranslation: true,
    promptedSites: {}
}, (settings) => {
    currentSettings = settings;
    
    // Auto translate if enabled
    if (settings.autoTranslate && shouldTranslatePage()) {
        setTimeout(() => translatePage(settings), 2000);
    } 
    // Auto prompt for translation on non-target language sites
    else if (settings.autoPromptTranslation !== false && shouldPromptTranslation(settings)) {
        setTimeout(() => showTranslationPrompt(settings), 1000);
    }
});

// Check if page should be translated
function shouldTranslatePage() {
    // Skip if page is already in target language
    const pageLang = detectPageLanguage();
    const targetLangCode = currentSettings.targetLanguage.toLowerCase().substring(0, 2);
    if (pageLang && pageLang.startsWith(targetLangCode)) {
        return false;
    }
    
    // Check excluded sites
    const excludedSites = currentSettings.excludedSites?.split('\n').filter(s => s.trim());
    if (excludedSites?.some(site => window.location.href.includes(site.trim()))) {
        return false;
    }
    
    return true;
}

// Check if should prompt for translation
function shouldPromptTranslation(settings) {
    // Don't prompt if auto-translate is on
    if (settings.autoTranslate) return false;
    
    // Check if already prompted for this site
    const currentHost = window.location.hostname;
    if (settings.promptedSites && settings.promptedSites[currentHost]) {
        const siteSettings = settings.promptedSites[currentHost];
        // If user previously chose 'never' for this site, don't prompt
        if (siteSettings.action === 'never') return false;
        // If user chose 'always', auto-translate instead of prompting
        if (siteSettings.action === 'always') {
            setTimeout(() => translatePage(settings), 2000);
            return false;
        }
    }
    
    // Check if page language differs from target language
    const pageLang = detectPageLanguage();
    const targetLangCode = settings.targetLanguage.toLowerCase().substring(0, 2);
    
    // Don't prompt if page is already in target language
    if (pageLang && pageLang.startsWith(targetLangCode)) {
        return false;
    }
    
    // Check excluded sites
    const excludedSites = settings.excludedSites?.split('\n').filter(s => s.trim());
    if (excludedSites?.some(site => window.location.href.includes(site.trim()))) {
        return false;
    }
    
    // Only prompt if there's substantial text content
    const textContent = document.body?.innerText || '';
    if (textContent.length < 100) return false;
    
    return true;
}

// Improved language detection
function detectPageLanguage() {
    // Priority 1: HTML lang attribute
    let pageLang = document.documentElement.lang?.toLowerCase();
    if (pageLang) return pageLang.split('-')[0];
    
    // Priority 2: Meta language tags
    const metaLang = document.querySelector('meta[http-equiv="content-language"]')?.content ||
                     document.querySelector('meta[name="language"]')?.content;
    if (metaLang) return metaLang.toLowerCase().split('-')[0];
    
    // Priority 3: Detect from text content
    const sampleText = getSampleText();
    if (sampleText) {
        return detectLanguageFromText(sampleText);
    }
    
    return null;
}

// Get sample text for language detection
function getSampleText() {
    // Get text from main content areas
    const contentSelectors = [
        'main', 'article', '[role="main"]', '#content', '.content',
        'p', 'h1', 'h2', 'h3'
    ];
    
    let sampleText = '';
    for (const selector of contentSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const elem of elements) {
            sampleText += elem.innerText + ' ';
            if (sampleText.length > 500) break;
        }
        if (sampleText.length > 500) break;
    }
    
    return sampleText.trim();
}

// Detect language from text content
function detectLanguageFromText(text) {
    if (!text) return null;
    
    // Common language patterns
    const patterns = {
        'zh': /[\u4e00-\u9fff\u3400-\u4dbf]/g, // Chinese
        'ja': /[\u3040-\u309f\u30a0-\u30ff]/g, // Japanese
        'ko': /[\uac00-\ud7af\u1100-\u11ff]/g, // Korean
        'ar': /[\u0600-\u06ff\u0750-\u077f]/g, // Arabic
        'ru': /[\u0400-\u04ff]/g, // Cyrillic
        'he': /[\u0590-\u05ff]/g, // Hebrew
        'th': /[\u0e00-\u0e7f]/g, // Thai
        'hi': /[\u0900-\u097f]/g, // Hindi
    };
    
    // Count matches for each language
    const counts = {};
    for (const [lang, pattern] of Object.entries(patterns)) {
        const matches = text.match(pattern);
        if (matches) {
            counts[lang] = matches.length;
        }
    }
    
    // Find language with most matches
    let maxCount = 0;
    let detectedLang = null;
    for (const [lang, count] of Object.entries(counts)) {
        if (count > maxCount && count > text.length * 0.1) { // At least 10% of text
            maxCount = count;
            detectedLang = lang;
        }
    }
    
    // If no non-Latin script detected, check for Latin-based languages
    if (!detectedLang) {
        // Simple heuristic for common words
        const langIndicators = {
            'en': /\b(the|and|of|to|in|is|you|that|was|for)\b/gi,
            'es': /\b(el|la|de|que|y|en|un|por|con|para)\b/gi,
            'fr': /\b(le|de|et|la|les|des|un|une|pour|dans)\b/gi,
            'de': /\b(der|die|und|das|den|von|zu|mit|sich|auf)\b/gi,
            'pt': /\b(o|a|de|e|do|da|em|para|com|por)\b/gi,
            'it': /\b(il|di|e|la|che|in|un|per|con|del)\b/gi,
        };
        
        for (const [lang, pattern] of Object.entries(langIndicators)) {
            const matches = text.match(pattern);
            if (matches && matches.length > 5) {
                counts[lang] = matches.length;
            }
        }
        
        // Find the best match
        maxCount = 0;
        for (const [lang, count] of Object.entries(counts)) {
            if (count > maxCount) {
                maxCount = count;
                detectedLang = lang;
            }
        }
    }
    
    return detectedLang;
}

// Show translation prompt
function showTranslationPrompt(settings) {
    // Don't show if already showing
    if (document.querySelector('.ultra-translate-prompt')) return;
    
    // Get detected language name
    const pageLang = detectPageLanguage();
    const langNames = {
        'zh': '中文',
        'en': 'English',
        'ja': '日本語',
        'ko': '한국어',
        'es': 'Español',
        'fr': 'Français',
        'de': 'Deutsch',
        'ru': 'Русский',
        'ar': 'العربية',
        'pt': 'Português',
        'it': 'Italiano',
        'hi': 'हिन्दी',
        'th': 'ไทย',
        'he': 'עברית'
    };
    
    const fromLang = langNames[pageLang] || pageLang || 'foreign language';
    const targetLang = getLanguageName(settings.targetLanguage);
    
    // Create prompt container
    const promptContainer = document.createElement('div');
    promptContainer.className = 'ultra-translate-prompt';
    promptContainer.innerHTML = `
        <div class="ultra-translate-prompt-content">
            <div class="ultra-translate-prompt-icon">🌐</div>
            <div class="ultra-translate-prompt-text">
                <div class="ultra-translate-prompt-title">
                    ${getPromptText('title', settings.interfaceLanguage)}
                </div>
                <div class="ultra-translate-prompt-subtitle">
                    ${getPromptText('detected', settings.interfaceLanguage)}: <strong>${fromLang}</strong> → <strong>${targetLang}</strong>
                </div>
            </div>
            <div class="ultra-translate-prompt-actions">
                <button class="ultra-translate-prompt-btn ultra-translate-prompt-translate">
                    ${getPromptText('translate', settings.interfaceLanguage)}
                </button>
                <button class="ultra-translate-prompt-btn ultra-translate-prompt-always">
                    ${getPromptText('always', settings.interfaceLanguage)}
                </button>
                <button class="ultra-translate-prompt-btn ultra-translate-prompt-never">
                    ${getPromptText('never', settings.interfaceLanguage)}
                </button>
                <button class="ultra-translate-prompt-close">×</button>
            </div>
        </div>
    `;
    
    // Add styles
    const styles = `
        .ultra-translate-prompt {
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            animation: ultra-translate-slide-in 0.3s ease-out;
            max-width: 420px;
            border: 1px solid rgba(0, 0, 0, 0.1);
        }
        
        @keyframes ultra-translate-slide-in {
            from {
                transform: translateX(420px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        .ultra-translate-prompt-content {
            display: flex;
            align-items: center;
            padding: 16px;
            gap: 12px;
        }
        
        .ultra-translate-prompt-icon {
            font-size: 32px;
            flex-shrink: 0;
        }
        
        .ultra-translate-prompt-text {
            flex: 1;
            min-width: 0;
        }
        
        .ultra-translate-prompt-title {
            font-size: 14px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 4px;
        }
        
        .ultra-translate-prompt-subtitle {
            font-size: 12px;
            color: #666;
        }
        
        .ultra-translate-prompt-subtitle strong {
            color: #333;
            font-weight: 500;
        }
        
        .ultra-translate-prompt-actions {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-left: 8px;
        }
        
        .ultra-translate-prompt-btn {
            padding: 6px 12px;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
            font-weight: 500;
        }
        
        .ultra-translate-prompt-translate {
            background: #10a37f;
            color: white;
        }
        
        .ultra-translate-prompt-translate:hover {
            background: #0d8968;
        }
        
        .ultra-translate-prompt-always {
            background: #e7f3ff;
            color: #0066cc;
        }
        
        .ultra-translate-prompt-always:hover {
            background: #d0e5ff;
        }
        
        .ultra-translate-prompt-never {
            background: #f5f5f5;
            color: #666;
        }
        
        .ultra-translate-prompt-never:hover {
            background: #e8e8e8;
        }
        
        .ultra-translate-prompt-close {
            position: absolute;
            top: 8px;
            right: 8px;
            width: 24px;
            height: 24px;
            border: none;
            background: transparent;
            color: #999;
            font-size: 20px;
            line-height: 1;
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.2s;
        }
        
        .ultra-translate-prompt-close:hover {
            background: #f0f0f0;
            color: #333;
        }
        
        @media (max-width: 480px) {
            .ultra-translate-prompt {
                top: 10px;
                right: 10px;
                left: 10px;
                max-width: none;
            }
            
            .ultra-translate-prompt-content {
                padding: 12px;
            }
            
            .ultra-translate-prompt-actions {
                flex-direction: row;
                flex-wrap: wrap;
            }
        }
        
        @media (prefers-color-scheme: dark) {
            .ultra-translate-prompt {
                background: #2a2a2a;
                border-color: rgba(255, 255, 255, 0.1);
            }
            
            .ultra-translate-prompt-title {
                color: #f0f0f0;
            }
            
            .ultra-translate-prompt-subtitle {
                color: #aaa;
            }
            
            .ultra-translate-prompt-subtitle strong {
                color: #ddd;
            }
            
            .ultra-translate-prompt-never {
                background: #3a3a3a;
                color: #ccc;
            }
            
            .ultra-translate-prompt-never:hover {
                background: #444;
            }
            
            .ultra-translate-prompt-close:hover {
                background: #3a3a3a;
                color: #f0f0f0;
            }
        }
    `;
    
    // Add styles to page
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
    
    // Add prompt to page
    document.body.appendChild(promptContainer);
    
    // Add event listeners
    const translateBtn = promptContainer.querySelector('.ultra-translate-prompt-translate');
    const alwaysBtn = promptContainer.querySelector('.ultra-translate-prompt-always');
    const neverBtn = promptContainer.querySelector('.ultra-translate-prompt-never');
    const closeBtn = promptContainer.querySelector('.ultra-translate-prompt-close');
    
    translateBtn.addEventListener('click', () => {
        removePrompt();
        translatePage(settings);
    });
    
    alwaysBtn.addEventListener('click', () => {
        saveSitePreference('always');
        removePrompt();
        translatePage(settings);
    });
    
    neverBtn.addEventListener('click', () => {
        saveSitePreference('never');
        removePrompt();
    });
    
    closeBtn.addEventListener('click', () => {
        removePrompt();
    });
    
    // Auto-hide after 30 seconds
    setTimeout(() => {
        removePrompt();
    }, 30000);
    
    function removePrompt() {
        promptContainer.style.animation = 'ultra-translate-slide-out 0.3s ease-in';
        setTimeout(() => {
            promptContainer.remove();
        }, 300);
    }
    
    // Add slide-out animation
    const slideOutStyle = document.createElement('style');
    slideOutStyle.textContent = `
        @keyframes ultra-translate-slide-out {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(420px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(slideOutStyle);
}

// Get prompt text in appropriate language
function getPromptText(key, interfaceLang = 'en') {
    const texts = {
        'en': {
            title: 'Translate this page?',
            detected: 'Detected',
            translate: 'Translate',
            always: 'Always',
            never: 'Never'
        },
        'zh-CN': {
            title: '翻译此页面？',
            detected: '检测到',
            translate: '翻译',
            always: '总是翻译',
            never: '永不翻译'
        },
        'zh-TW': {
            title: '翻譯此頁面？',
            detected: '偵測到',
            translate: '翻譯',
            always: '總是翻譯',
            never: '永不翻譯'
        },
        'ja': {
            title: 'このページを翻訳しますか？',
            detected: '検出された',
            translate: '翻訳',
            always: '常に翻訳',
            never: '翻訳しない'
        },
        'ko': {
            title: '이 페이지를 번역하시겠습니까?',
            detected: '감지됨',
            translate: '번역',
            always: '항상 번역',
            never: '번역 안 함'
        },
        'es': {
            title: '¿Traducir esta página?',
            detected: 'Detectado',
            translate: 'Traducir',
            always: 'Siempre',
            never: 'Nunca'
        },
        'fr': {
            title: 'Traduire cette page?',
            detected: 'Détecté',
            translate: 'Traduire',
            always: 'Toujours',
            never: 'Jamais'
        },
        'de': {
            title: 'Diese Seite übersetzen?',
            detected: 'Erkannt',
            translate: 'Übersetzen',
            always: 'Immer',
            never: 'Niemals'
        },
        'ru': {
            title: 'Перевести эту страницу?',
            detected: 'Обнаружен',
            translate: 'Перевести',
            always: 'Всегда',
            never: 'Никогда'
        }
    };
    
    return texts[interfaceLang]?.[key] || texts['en'][key];
}

// Save site preference
function saveSitePreference(action) {
    const currentHost = window.location.hostname;
    chrome.storage.sync.get(['promptedSites'], (result) => {
        const promptedSites = result.promptedSites || {};
        promptedSites[currentHost] = {
            action: action,
            timestamp: Date.now()
        };
        chrome.storage.sync.set({ promptedSites });
    });
}

// Get language name
function getLanguageName(code) {
    const languages = {
        'zh-CN': '简体中文',
        'zh-TW': '繁體中文',
        'en': 'English',
        'es': 'Español',
        'fr': 'Français',
        'de': 'Deutsch',
        'ja': '日本語',
        'ko': '한국어',
        'ru': 'Русский',
        'ar': 'العربية'
    };
    return languages[code] || code;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translatePage') {
        currentSettings = request.settings;
        translatePage(request.settings);
        sendResponse({success: true});
    } else if (request.action === 'updateSettings') {
        currentSettings = request.settings;
    } else if (request.action === 'stopTranslation') {
        isTranslating = false;
        removeLoadingIndicator();
        sendResponse({success: true});
    } else if (request.action === 'toggleTranslation') {
        toggleTranslation();
        sendResponse({success: true});
    } else if (request.action === 'restoreOriginal') {
        restoreOriginalText(document.body);
        sendResponse({success: true});
    }
    return true;
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Alt+T: Toggle translation
    if (e.altKey && e.key === 't') {
        e.preventDefault();
        toggleTranslation();
    }
    // Alt+O: Toggle original text visibility (when preserve mode is on)
    else if (e.altKey && e.key === 'o') {
        e.preventDefault();
        toggleOriginalTextVisibility();
    }
});

// Toggle visibility of original text in preserve mode
function toggleOriginalTextVisibility() {
    const originalElements = document.querySelectorAll('.ultra-translate-original');
    originalElements.forEach(elem => {
        const currentDisplay = window.getComputedStyle(elem).display;
        elem.style.display = currentDisplay === 'none' ? '' : 'none';
    });
}

async function translatePage(settings) {
    if (isTranslating) {
        console.log('Translation already in progress');
        return;
    }
    
    isTranslating = true;
    
    // Create loading indicator
    createLoadingIndicator();
    
    const textNodes = getTextNodes(document.body);
    
    // Group text nodes by similarity and context for better batch processing
    const optimizedBatches = createOptimizedBatches(textNodes, settings);
    const totalBatches = optimizedBatches.length;
    let processedBatches = 0;
    
    // Process batches with concurrent translation for better performance
    const concurrentLimit = 3;
    for (let i = 0; i < optimizedBatches.length; i += concurrentLimit) {
        const currentBatches = optimizedBatches.slice(i, i + concurrentLimit);
        await Promise.all(currentBatches.map(async batch => {
            await translateBatch(batch, settings);
            processedBatches++;
            updateLoadingProgress(processedBatches, totalBatches);
        }));
        await delay(50); // Reduced delay for better performance
    }
    
    // Translate form elements and attributes
    await translateFormElements(settings);
    await translateAttributes(settings);
    
    // Remove loading indicator
    removeLoadingIndicator();
    isTranslating = false;
}

function getTextNodes(element) {
    const textNodes = [];
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // Skip if already translated
                if (translatedNodes.has(node)) return NodeFilter.FILTER_REJECT;
                
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                
                // Enhanced tag filtering
                const tagName = parent.tagName?.toLowerCase();
                const skipTags = [
                    'script', 'style', 'noscript', 'iframe', 'object', 'embed',
                    'pre', 'code', 'kbd', 'samp', 'var', // Code-related elements
                    'math', 'svg', 'canvas', // Technical elements
                    'textarea', 'input' // Form input elements (but keep select/option for translation)
                ];
                if (skipTags.includes(tagName)) {
                    return NodeFilter.FILTER_REJECT;
                }
                
                // Skip contenteditable elements
                if (parent.contentEditable === 'true' || parent.isContentEditable) {
                    return NodeFilter.FILTER_REJECT;
                }
                
                // Skip aria-hidden elements
                if (parent.getAttribute('aria-hidden') === 'true') {
                    return NodeFilter.FILTER_REJECT;
                }
                
                // Skip translation attributes
                if (parent.getAttribute('translate') === 'no' || 
                    parent.classList?.contains('notranslate') ||
                    parent.classList?.contains('ultra-translate-wrapper') ||
                    parent.classList?.contains('ultra-translate-original') ||
                    parent.classList?.contains('ultra-translate-translated')) {
                    return NodeFilter.FILTER_REJECT;
                }
                
                // Check visibility with cached computed styles
                if (!isElementVisible(parent)) {
                    return NodeFilter.FILTER_REJECT;
                }
                
                // Text content validation
                const text = node.nodeValue.trim();
                if (text.length < 2) return NodeFilter.FILTER_REJECT;
                
                // Skip pure numbers, punctuation, and symbols
                if (/^[\d\s\.\,\!\?\-\+\*\/\=\(\)\[\]\{\}\<\>\@\#\$\%\^\&\*\_\~\`\|\\]+$/.test(text)) {
                    return NodeFilter.FILTER_REJECT;
                }
                
                // Skip URLs and emails
                if (/^(https?:\/\/|www\.|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/.test(text)) {
                    return NodeFilter.FILTER_REJECT;
                }
                
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );
    
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    
    return textNodes;
}

// Check element visibility with caching
function isElementVisible(element) {
    // Check cache first
    if (computedStyleCache.has(element)) {
        return computedStyleCache.get(element);
    }
    
    const rect = element.getBoundingClientRect();
    // Skip zero-sized elements
    if (rect.width === 0 || rect.height === 0) {
        computedStyleCache.set(element, false);
        return false;
    }
    
    const style = window.getComputedStyle(element);
    // Skip hidden elements
    const isVisible = !(
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        (element.offsetWidth === 0 && element.offsetHeight === 0)
    );
    
    // Cache the result
    computedStyleCache.set(element, isVisible);
    return isVisible;
}

function createBatches(nodes, batchSize) {
    const batches = [];
    for (let i = 0; i < nodes.length; i += batchSize) {
        batches.push(nodes.slice(i, i + batchSize));
    }
    return batches;
}

function createOptimizedBatches(nodes, settings) {
    const batches = [];
    const maxBatchSize = settings.translationApi === 'google' ? 30 : 50;
    const maxTextLength = 1000; // Max characters per batch
    
    // Group nodes by context for better translation coherence
    const contextGroups = groupNodesByContext(nodes);
    
    for (const group of contextGroups) {
        let currentBatch = [];
        let currentLength = 0;
        
        for (const nodeInfo of group) {
            const textLength = nodeInfo.text.length;
            
            // Start new batch if current batch is full
            if (currentBatch.length >= maxBatchSize || 
                (currentLength + textLength > maxTextLength && currentBatch.length > 0)) {
                if (currentBatch.length > 0) {
                    batches.push(currentBatch.map(info => info.node));
                }
                currentBatch = [];
                currentLength = 0;
            }
            
            currentBatch.push(nodeInfo);
            currentLength += textLength;
        }
        
        if (currentBatch.length > 0) {
            batches.push(currentBatch.map(info => info.node));
        }
    }
    
    return batches;
}

// Group nodes by their context (parent element) for better translation coherence
function groupNodesByContext(nodes) {
    const groups = new Map();
    const segmenter = createSegmenter();
    
    for (const node of nodes) {
        const parent = node.parentElement;
        const context = getContextKey(parent);
        
        if (!groups.has(context)) {
            groups.set(context, []);
        }
        
        // Segment text if it's long enough
        const text = node.nodeValue.trim();
        if (segmenter && text.length > 100) {
            const segments = segmentText(text, segmenter);
            // If text contains multiple sentences, consider splitting
            if (segments.length > 1) {
                // Store original text for later reconstruction
                originalTextMap.set(node, text);
            }
        }
        
        groups.get(context).push({
            node: node,
            text: text,
            parent: parent
        });
    }
    
    return Array.from(groups.values());
}

// Create appropriate segmenter based on source language
function createSegmenter() {
    if (!Intl.Segmenter) {
        console.warn('Intl.Segmenter not supported in this browser');
        return null;
    }
    
    try {
        // Detect page language
        const pageLang = document.documentElement.lang || 'en';
        const langCode = pageLang.split('-')[0];
        
        // Create sentence segmenter for detected language
        return new Intl.Segmenter(langCode, { granularity: 'sentence' });
    } catch (error) {
        console.warn('Failed to create segmenter:', error);
        // Fallback to English segmenter
        try {
            return new Intl.Segmenter('en', { granularity: 'sentence' });
        } catch {
            return null;
        }
    }
}

// Segment text into sentences
function segmentText(text, segmenter) {
    if (!segmenter) return [text];
    
    const segments = [];
    const iterator = segmenter.segment(text);
    
    for (const {segment} of iterator) {
        const trimmed = segment.trim();
        if (trimmed.length > 0) {
            segments.push(trimmed);
        }
    }
    
    return segments.length > 0 ? segments : [text];
}

// Get a unique key for grouping nodes by context
function getContextKey(element) {
    if (!element) return 'none';
    
    // Group by parent element and its position
    const tag = element.tagName?.toLowerCase() || 'unknown';
    const id = element.id ? `#${element.id}` : '';
    const className = element.className ? `.${element.className.split(' ')[0]}` : '';
    
    // Include parent's parent for better context
    const parentTag = element.parentElement?.tagName?.toLowerCase() || '';
    
    return `${parentTag}>${tag}${id}${className}`;
}

async function translateBatch(nodes, settings) {
    const texts = nodes.map(node => node.nodeValue.trim());
    
    try {
        const translations = await sendTranslationRequest(texts, settings);
        
        nodes.forEach((node, index) => {
            if (translations[index]) {
                applyTranslation(node, translations[index], settings.preserveOriginal);
                translatedNodes.add(node);
            }
        });
    } catch (error) {
        console.error('Translation error:', error);
    }
}

async function sendTranslationRequest(texts, settings) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: 'translate',
            texts: texts,
            settings: settings
        }, (response) => {
            if (response && response.translations) {
                resolve(response.translations);
            } else {
                resolve(texts.map(() => ''));
            }
        });
    });
}

// Translate form elements (select options, buttons, labels)
async function translateFormElements(settings) {
    // Translate select options
    const options = document.querySelectorAll('option');
    const optionTexts = [];
    const optionElements = [];
    
    options.forEach(option => {
        const text = option.textContent.trim();
        if (text && text.length > 1 && !translatedNodes.has(option)) {
            optionTexts.push(text);
            optionElements.push(option);
        }
    });
    
    // Translate button texts
    const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]');
    const buttonTexts = [];
    const buttonElements = [];
    
    buttons.forEach(button => {
        const text = button.textContent?.trim() || button.value?.trim();
        if (text && text.length > 1 && !translatedNodes.has(button)) {
            buttonTexts.push(text);
            buttonElements.push(button);
        }
    });
    
    // Translate labels
    const labels = document.querySelectorAll('label');
    const labelTexts = [];
    const labelElements = [];
    
    labels.forEach(label => {
        const text = label.textContent.trim();
        if (text && text.length > 1 && !translatedNodes.has(label) && !label.querySelector('input, select, textarea')) {
            labelTexts.push(text);
            labelElements.push(label);
        }
    });
    
    // Combine all texts for batch translation
    const allTexts = [...optionTexts, ...buttonTexts, ...labelTexts];
    const allElements = [...optionElements, ...buttonElements, ...labelElements];
    
    if (allTexts.length > 0) {
        const translations = await sendTranslationRequest(allTexts, settings);
        
        // Apply translations
        allElements.forEach((element, index) => {
            if (translations[index]) {
                if (element.tagName === 'OPTION') {
                    element.textContent = translations[index];
                    translatedNodes.add(element);
                } else if (element.tagName === 'INPUT') {
                    element.value = translations[index];
                    translatedNodes.add(element);
                } else if (element.tagName === 'BUTTON' || element.tagName === 'LABEL') {
                    // For buttons and labels, preserve child elements
                    const children = Array.from(element.childNodes);
                    const textNode = children.find(node => node.nodeType === Node.TEXT_NODE);
                    if (textNode) {
                        textNode.textContent = translations[index];
                    } else {
                        element.textContent = translations[index];
                    }
                    translatedNodes.add(element);
                }
            }
        });
    }
}

// Translate attributes (title, placeholder, alt)
async function translateAttributes(settings) {
    const elementsWithTitle = document.querySelectorAll('[title]');
    const elementsWithPlaceholder = document.querySelectorAll('[placeholder]');
    const elementsWithAlt = document.querySelectorAll('[alt]');
    
    const attributeTexts = [];
    const attributeInfo = [];
    
    // Collect title attributes
    elementsWithTitle.forEach(elem => {
        const title = elem.getAttribute('title')?.trim();
        if (title && title.length > 1) {
            attributeTexts.push(title);
            attributeInfo.push({ element: elem, attribute: 'title', originalValue: title });
        }
    });
    
    // Collect placeholder attributes
    elementsWithPlaceholder.forEach(elem => {
        const placeholder = elem.getAttribute('placeholder')?.trim();
        if (placeholder && placeholder.length > 1) {
            attributeTexts.push(placeholder);
            attributeInfo.push({ element: elem, attribute: 'placeholder', originalValue: placeholder });
        }
    });
    
    // Collect alt attributes
    elementsWithAlt.forEach(elem => {
        const alt = elem.getAttribute('alt')?.trim();
        if (alt && alt.length > 1) {
            attributeTexts.push(alt);
            attributeInfo.push({ element: elem, attribute: 'alt', originalValue: alt });
        }
    });
    
    if (attributeTexts.length > 0) {
        const translations = await sendTranslationRequest(attributeTexts, settings);
        
        // Apply translated attributes
        attributeInfo.forEach((info, index) => {
            if (translations[index]) {
                info.element.setAttribute(info.attribute, translations[index]);
                // Store original value for restoration
                if (!info.element.dataset.originalAttributes) {
                    info.element.dataset.originalAttributes = JSON.stringify({});
                }
                const originalAttrs = JSON.parse(info.element.dataset.originalAttributes);
                originalAttrs[info.attribute] = info.originalValue;
                info.element.dataset.originalAttributes = JSON.stringify(originalAttrs);
            }
        });
    }
}

function applyTranslation(textNode, translation, preserveOriginal) {
    if (!translation || translation === textNode.nodeValue.trim()) return;
    
    const parent = textNode.parentElement;
    if (!parent) return;
    
    // Store original text in WeakMap
    const originalText = textNode.nodeValue;
    originalTextMap.set(textNode, originalText);
    
    // Detect source and target languages
    const sourceLang = detectLanguage(originalText);
    const targetLang = currentSettings.targetLanguage || 'en';
    const isRTL = RTL_LANGUAGES.includes(targetLang.split('-')[0]);
    
    // Check parent element type for better layout handling
    const parentTag = parent.tagName?.toLowerCase();
    const isInlineContext = ['span', 'a', 'strong', 'em', 'b', 'i', 'u', 'mark', 'abbr', 'cite', 'q'].includes(parentTag);
    const isBlockContext = ['p', 'div', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(parentTag);
    
    if (preserveOriginal) {
        const wrapper = document.createElement(isInlineContext ? 'span' : 'div');
        wrapper.className = 'ultra-translate-wrapper';
        
        // Add accessibility attributes to wrapper
        wrapper.setAttribute('role', 'group');
        wrapper.setAttribute('aria-label', 'Translation');
        
        // Original text span with accessibility attributes
        const originalSpan = document.createElement('span');
        originalSpan.className = 'ultra-translate-original';
        originalSpan.textContent = originalText;
        originalSpan.title = 'Original text';
        originalSpan.setAttribute('lang', sourceLang);
        originalSpan.setAttribute('aria-hidden', 'true'); // Prevent screen readers from reading twice
        originalSpan.setAttribute('translate', 'no');
        
        // Translated text span with proper language attributes
        const translatedSpan = document.createElement('span');
        translatedSpan.className = 'ultra-translate-translated';
        translatedSpan.textContent = translation;
        translatedSpan.title = 'Translated text';
        translatedSpan.setAttribute('lang', targetLang);
        translatedSpan.setAttribute('aria-live', 'polite');
        
        // Add RTL support if needed
        if (isRTL) {
            translatedSpan.setAttribute('dir', 'rtl');
        }
        
        // Structure based on context
        if (isInlineContext) {
            // For inline elements, use separator
            const separator = document.createElement('span');
            separator.className = 'ultra-translate-separator';
            separator.setAttribute('aria-hidden', 'true');
            separator.textContent = ' | ';
            
            wrapper.appendChild(originalSpan);
            wrapper.appendChild(separator);
            wrapper.appendChild(translatedSpan);
        } else {
            // For block elements, stack vertically
            wrapper.appendChild(originalSpan);
            wrapper.appendChild(translatedSpan);
        }
        
        parent.replaceChild(wrapper, textNode);
    } else {
        // Replacement mode - store original in WeakMap
        const translatedSpan = document.createElement('span');
        translatedSpan.className = 'ultra-translate-translated';
        translatedSpan.textContent = translation;
        translatedSpan.title = originalText; // Tooltip shows original
        translatedSpan.setAttribute('lang', targetLang);
        translatedSpan.setAttribute('data-original-lang', sourceLang);
        
        // Add RTL support if needed
        if (isRTL) {
            translatedSpan.setAttribute('dir', 'rtl');
        }
        
        // Store reference to original text
        originalTextMap.set(translatedSpan, originalText);
        
        parent.replaceChild(translatedSpan, textNode);
    }
    
    // Mark as translated
    translatedNodes.add(textNode);
}

// Simple language detection based on Unicode ranges
function detectLanguage(text) {
    if (!text) return 'en';
    
    // Check for common scripts
    const hasHan = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text); // Chinese
    const hasHiragana = /[\u3040-\u309f]/.test(text); // Japanese
    const hasKatakana = /[\u30a0-\u30ff]/.test(text); // Japanese
    const hasHangul = /[\uac00-\ud7af\u1100-\u11ff]/.test(text); // Korean
    const hasArabic = /[\u0600-\u06ff\u0750-\u077f]/.test(text); // Arabic
    const hasCyrillic = /[\u0400-\u04ff]/.test(text); // Russian, etc.
    const hasHebrew = /[\u0590-\u05ff]/.test(text); // Hebrew
    
    // Return detected language code
    if (hasHan) return 'zh';
    if (hasHiragana || hasKatakana) return 'ja';
    if (hasHangul) return 'ko';
    if (hasArabic) return 'ar';
    if (hasCyrillic) return 'ru';
    if (hasHebrew) return 'he';
    
    // Try to use page language or default to English
    return document.documentElement.lang?.split('-')[0] || 'en';
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Debounce function for better performance
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttled translation for mutation observer
const throttledTranslate = debounce(async () => {
    if (!currentSettings.autoTranslate || isTranslating) return;
    
    const newTextNodes = getTextNodes(document.body);
    if (newTextNodes.length > 0) {
        const optimizedBatches = createOptimizedBatches(newTextNodes, currentSettings);
        for (const batch of optimizedBatches) {
            await translateBatch(batch, currentSettings);
        }
    }
    
    // Also translate any new form elements and attributes
    await translateFormElements(currentSettings);
    await translateAttributes(currentSettings);
}, 800); // Reduced debounce time for faster response

// Function to restore original text
function restoreOriginalText(element) {
    const translatedElements = element.querySelectorAll('.ultra-translate-wrapper, .ultra-translate-translated');
    
    translatedElements.forEach(elem => {
        const originalText = originalTextMap.get(elem);
        if (originalText) {
            const textNode = document.createTextNode(originalText);
            elem.parentNode?.replaceChild(textNode, elem);
            originalTextMap.delete(elem);
        }
    });
    
    // Restore original attributes
    const elementsWithOriginalAttributes = element.querySelectorAll('[data-original-attributes]');
    elementsWithOriginalAttributes.forEach(elem => {
        try {
            const originalAttrs = JSON.parse(elem.dataset.originalAttributes);
            Object.entries(originalAttrs).forEach(([attr, value]) => {
                elem.setAttribute(attr, value);
            });
            delete elem.dataset.originalAttributes;
        } catch (e) {
            console.error('Error restoring attributes:', e);
        }
    });
    
    // Clear translated nodes set
    translatedNodes.clear();
}

// Toggle translation on/off
function toggleTranslation() {
    if (document.querySelector('.ultra-translate-wrapper, .ultra-translate-translated')) {
        restoreOriginalText(document.body);
    } else {
        translatePage(currentSettings);
    }
}

const observer = new MutationObserver((mutations) => {
    if (!currentSettings.autoTranslate) return;
    
    let hasNewContent = false;
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent?.trim();
                    if (text && text.length > 1) {
                        hasNewContent = true;
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    // Skip if already translated
                    if (node.classList && 
                        (node.classList.contains('ultra-translate-wrapper') || 
                         node.classList.contains('ultra-translate-translated'))) {
                        return;
                    }
                    
                    // Check for text content or form elements
                    if (node.textContent?.trim() || 
                        node.tagName === 'SELECT' || 
                        node.tagName === 'OPTION' ||
                        node.tagName === 'BUTTON' ||
                        node.tagName === 'LABEL' ||
                        node.querySelector && node.querySelector('select, option, button, label, [title], [placeholder], [alt]')) {
                        hasNewContent = true;
                    }
                }
            });
        } else if (mutation.type === 'attributes') {
            // Check for dynamically added attributes
            if (mutation.attributeName === 'title' || 
                mutation.attributeName === 'placeholder' || 
                mutation.attributeName === 'alt' ||
                mutation.attributeName === 'value') {
                hasNewContent = true;
            }
        }
    });
    
    if (hasNewContent) {
        throttledTranslate();
    }
});

// Video subtitle translation functionality
let videoSubtitleSettings = {
    enabled: false,
    mode: 'translate', // 'off' | 'translate' | 'asr'
    bilingualMode: 'overlay', // 'track' | 'overlay'
    asrProvider: 'whisper', // 'whisper' | 'google-stt' | 'deepgram'
    latencyMode: 'balanced' // 'low' | 'balanced' | 'high'
};

const translatedTracks = new WeakMap();
const videoObservers = new WeakMap();

// VTT/SRT parsing utilities
function parseVTT(content) {
    const cues = [];
    const lines = content.split('\n');
    let i = 0;
    
    // Skip WEBVTT header
    while (i < lines.length && !lines[i].includes('-->')) {
        i++;
    }
    
    while (i < lines.length) {
        // Skip empty lines
        while (i < lines.length && !lines[i].trim()) {
            i++;
        }
        
        if (i >= lines.length) break;
        
        // Check for timestamp line
        const timestampLine = lines[i];
        if (timestampLine.includes('-->')) {
            const [start, end] = timestampLine.split('-->').map(s => s.trim());
            const startTime = parseVTTTime(start);
            const endTime = parseVTTTime(end);
            
            i++;
            const textLines = [];
            
            // Collect text lines until empty line or next cue
            while (i < lines.length && lines[i].trim() && !lines[i].includes('-->')) {
                textLines.push(lines[i]);
                i++;
            }
            
            if (textLines.length > 0) {
                cues.push({
                    startTime,
                    endTime,
                    text: textLines.join('\n')
                });
            }
        } else {
            i++;
        }
    }
    
    return cues;
}

function parseSRT(content) {
    const cues = [];
    const blocks = content.trim().split(/\n\s*\n/);
    
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;
        
        // Find timestamp line
        let timestampIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('-->')) {
                timestampIndex = i;
                break;
            }
        }
        
        if (timestampIndex === -1) continue;
        
        const [start, end] = lines[timestampIndex].split('-->').map(s => s.trim());
        const startTime = parseSRTTime(start);
        const endTime = parseSRTTime(end);
        
        const textLines = lines.slice(timestampIndex + 1);
        if (textLines.length > 0) {
            cues.push({
                startTime,
                endTime,
                text: textLines.join('\n')
            });
        }
    }
    
    return cues;
}

function parseVTTTime(timeStr) {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
        const [h, m, s] = parts;
        return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
    } else if (parts.length === 2) {
        const [m, s] = parts;
        return parseFloat(m) * 60 + parseFloat(s);
    }
    return parseFloat(timeStr) || 0;
}

function parseSRTTime(timeStr) {
    const timePart = timeStr.replace(',', '.');
    return parseVTTTime(timePart);
}

function formatVTTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = (seconds % 60).toFixed(3);
    
    if (h > 0) {
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.padStart(6, '0')}`;
    } else {
        return `${m.toString().padStart(2, '0')}:${s.padStart(6, '0')}`;
    }
}

// Subtitle detection and extraction
async function detectVideoSubtitles(video) {
    const subtitleInfo = {
        hasSubtitles: false,
        tracks: [],
        targetLanguageAvailable: false
    };
    
    // Check for HTML5 video tracks
    if (video.textTracks && video.textTracks.length > 0) {
        for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            if (track.kind === 'subtitles' || track.kind === 'captions') {
                subtitleInfo.hasSubtitles = true;
                subtitleInfo.tracks.push({
                    language: track.language,
                    label: track.label,
                    mode: track.mode,
                    track: track,
                    index: i
                });
                
                if (track.language === currentSettings.targetLanguage) {
                    subtitleInfo.targetLanguageAvailable = true;
                }
            }
        }
    }
    
    // Check for track elements
    const trackElements = video.querySelectorAll('track');
    trackElements.forEach(trackEl => {
        const kind = trackEl.kind || 'subtitles';
        if (kind === 'subtitles' || kind === 'captions') {
            subtitleInfo.hasSubtitles = true;
        }
    });
    
    return subtitleInfo;
}

// Extract subtitle cues from track
async function extractSubtitleCues(track) {
    const cues = [];
    
    // First try to get cues directly
    if (track.cues && track.cues.length > 0) {
        for (let i = 0; i < track.cues.length; i++) {
            const cue = track.cues[i];
            cues.push({
                startTime: cue.startTime,
                endTime: cue.endTime,
                text: cue.text
            });
        }
        return cues;
    }
    
    // If track has a source URL, try to fetch it
    const trackElement = document.querySelector(`track[srclang="${track.language}"]`);
    if (trackElement && trackElement.src) {
        try {
            const response = await fetch(trackElement.src);
            const content = await response.text();
            
            // Determine format and parse
            if (content.includes('WEBVTT')) {
                return parseVTT(content);
            } else {
                return parseSRT(content);
            }
        } catch (error) {
            console.warn('Failed to fetch subtitle track:', error);
        }
    }
    
    return cues;
}

// Batch translate subtitle cues
async function translateSubtitleCues(cues, settings) {
    const batchSize = 50;
    const maxCharsPerBatch = 5000;
    const translatedCues = [];
    
    for (let i = 0; i < cues.length; i += batchSize) {
        const batch = [];
        let currentChars = 0;
        
        for (let j = i; j < Math.min(i + batchSize, cues.length); j++) {
            const cue = cues[j];
            if (currentChars + cue.text.length > maxCharsPerBatch && batch.length > 0) {
                break;
            }
            batch.push(cue);
            currentChars += cue.text.length;
        }
        
        if (batch.length === 0) continue;
        
        // Extract texts for translation
        const texts = batch.map(cue => cue.text);
        
        try {
            // Send translation request
            const translations = await sendTranslationRequest(texts, settings);
            
            // Map translations back to cues
            batch.forEach((cue, index) => {
                translatedCues.push({
                    startTime: cue.startTime,
                    endTime: cue.endTime,
                    originalText: cue.text,
                    text: translations[index] || cue.text
                });
            });
        } catch (error) {
            console.error('Subtitle translation error:', error);
            // Fallback to original text
            batch.forEach(cue => {
                translatedCues.push({
                    startTime: cue.startTime,
                    endTime: cue.endTime,
                    originalText: cue.text,
                    text: cue.text
                });
            });
        }
        
        // Small delay between batches
        await delay(100);
    }
    
    return translatedCues;
}

// Generate VTT content from cues
function generateVTT(cues, language) {
    let vtt = 'WEBVTT\n\n';
    
    cues.forEach((cue, index) => {
        vtt += `${index + 1}\n`;
        vtt += `${formatVTTTime(cue.startTime)} --> ${formatVTTTime(cue.endTime)}\n`;
        vtt += `${cue.text}\n\n`;
    });
    
    return vtt;
}

// Create and inject translated subtitle track
function injectTranslatedTrack(video, translatedCues, targetLanguage) {
    // Remove existing translated track if any
    const existingTrack = video.querySelector('track.ultra-translate-track');
    if (existingTrack) {
        existingTrack.remove();
    }
    
    // Generate VTT content
    const vttContent = generateVTT(translatedCues, targetLanguage);
    
    // Create blob URL
    const blob = new Blob([vttContent], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    
    // Create track element
    const trackElement = document.createElement('track');
    trackElement.className = 'ultra-translate-track';
    trackElement.kind = 'subtitles';
    trackElement.srclang = targetLanguage;
    trackElement.label = `UltraTranslate (${targetLanguage})`;
    trackElement.src = url;
    trackElement.default = true;
    
    // Add track to video
    video.appendChild(trackElement);
    
    // Set track mode to showing
    setTimeout(() => {
        const addedTrack = Array.from(video.textTracks).find(
            t => t.label === `UltraTranslate (${targetLanguage})`
        );
        if (addedTrack) {
            addedTrack.mode = 'showing';
            
            // Hide other tracks
            for (let i = 0; i < video.textTracks.length; i++) {
                const track = video.textTracks[i];
                if (track !== addedTrack && (track.kind === 'subtitles' || track.kind === 'captions')) {
                    track.mode = 'hidden';
                }
            }
        }
    }, 100);
    
    // Store reference for cleanup
    translatedTracks.set(video, { url, trackElement });
}

// Create bilingual subtitle overlay
function createBilingualOverlay(video, translatedCues) {
    // Remove existing overlay if any
    const existingOverlay = video.parentElement?.querySelector('.ultra-translate-subtitle-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }
    
    // Create overlay container
    const overlay = document.createElement('div');
    overlay.className = 'ultra-translate-subtitle-overlay';
    overlay.style.cssText = `
        position: absolute;
        bottom: 10%;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        pointer-events: none;
        z-index: 999999;
        max-width: 80%;
        font-size: 18px;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
    `;
    
    // Create original text element
    const originalText = document.createElement('div');
    originalText.className = 'ultra-translate-subtitle-original';
    originalText.style.cssText = `
        color: rgba(255, 255, 255, 0.7);
        margin-bottom: 5px;
    `;
    
    // Create translated text element
    const translatedText = document.createElement('div');
    translatedText.className = 'ultra-translate-subtitle-translated';
    translatedText.style.cssText = `
        color: #10a37f;
        font-weight: bold;
    `;
    
    overlay.appendChild(originalText);
    overlay.appendChild(translatedText);
    
    // Position overlay relative to video
    const videoContainer = video.parentElement;
    if (videoContainer) {
        videoContainer.style.position = 'relative';
        videoContainer.appendChild(overlay);
    }
    
    // Update overlay based on video time
    let currentCue = null;
    
    const updateOverlay = () => {
        const currentTime = video.currentTime;
        const activeCue = translatedCues.find(
            cue => currentTime >= cue.startTime && currentTime <= cue.endTime
        );
        
        if (activeCue !== currentCue) {
            currentCue = activeCue;
            if (activeCue) {
                originalText.textContent = activeCue.originalText || '';
                translatedText.textContent = activeCue.text;
                overlay.style.display = 'block';
            } else {
                overlay.style.display = 'none';
            }
        }
    };
    
    // Listen to video time updates
    video.addEventListener('timeupdate', updateOverlay);
    
    // Store reference for cleanup
    const overlayData = translatedTracks.get(video) || {};
    overlayData.overlay = overlay;
    overlayData.updateHandler = updateOverlay;
    translatedTracks.set(video, overlayData);
}

// Main video subtitle translation handler
async function handleVideoSubtitles(video) {
    // Skip if already processed
    if (translatedTracks.has(video)) {
        return;
    }
    
    const subtitleInfo = await detectVideoSubtitles(video);
    
    if (!subtitleInfo.hasSubtitles) {
        // No subtitles, could implement ASR here in the future
        console.log('No subtitles found for video');
        return;
    }
    
    if (subtitleInfo.targetLanguageAvailable) {
        // Target language already available, just enable it
        const targetTrack = subtitleInfo.tracks.find(
            t => t.language === currentSettings.targetLanguage
        );
        if (targetTrack) {
            targetTrack.track.mode = 'showing';
        }
        return;
    }
    
    // Find a source track to translate
    const sourceTrack = subtitleInfo.tracks.find(t => t.track.mode !== 'disabled') || 
                        subtitleInfo.tracks[0];
    
    if (!sourceTrack) {
        console.log('No source subtitle track found');
        return;
    }
    
    // Ensure track is loaded
    sourceTrack.track.mode = 'hidden';
    
    // Wait for cues to load
    await new Promise(resolve => {
        if (sourceTrack.track.cues && sourceTrack.track.cues.length > 0) {
            resolve();
        } else {
            sourceTrack.track.addEventListener('load', resolve, { once: true });
            setTimeout(resolve, 3000); // Timeout after 3 seconds
        }
    });
    
    // Extract cues
    const cues = await extractSubtitleCues(sourceTrack.track);
    
    if (cues.length === 0) {
        console.log('No subtitle cues found');
        return;
    }
    
    // Translate cues
    const translatedCues = await translateSubtitleCues(cues, currentSettings);
    
    // Apply based on bilingual mode
    if (videoSubtitleSettings.bilingualMode === 'overlay') {
        createBilingualOverlay(video, translatedCues);
    } else {
        injectTranslatedTrack(video, translatedCues, currentSettings.targetLanguage);
    }
}

// Clean up video subtitle resources
function cleanupVideoSubtitles(video) {
    const data = translatedTracks.get(video);
    if (data) {
        // Clean up blob URL
        if (data.url) {
            URL.revokeObjectURL(data.url);
        }
        
        // Remove track element
        if (data.trackElement) {
            data.trackElement.remove();
        }
        
        // Remove overlay
        if (data.overlay) {
            data.overlay.remove();
        }
        
        // Remove event handler
        if (data.updateHandler) {
            video.removeEventListener('timeupdate', data.updateHandler);
        }
        
        translatedTracks.delete(video);
    }
}

// Monitor for new videos on the page
function observeVideos() {
    // Process existing videos
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        if (!videoObservers.has(video) && videoSubtitleSettings.enabled) {
            // Observe video for changes
            const observer = new MutationObserver(() => {
                if (videoSubtitleSettings.enabled) {
                    handleVideoSubtitles(video);
                }
            });
            
            observer.observe(video, {
                attributes: true,
                attributeFilter: ['src'],
                childList: true
            });
            
            videoObservers.set(video, observer);
            
            // Handle subtitles when video is ready
            if (video.readyState >= 2) {
                handleVideoSubtitles(video);
            } else {
                video.addEventListener('loadedmetadata', () => {
                    handleVideoSubtitles(video);
                }, { once: true });
            }
        }
    });
}

// Update video subtitle settings from storage
chrome.storage.sync.get({
    videoSubtitles: false,
    videoSubtitleMode: 'translate',
    videoBilingualMode: 'overlay'
}, (settings) => {
    videoSubtitleSettings.enabled = settings.videoSubtitles;
    videoSubtitleSettings.mode = settings.videoSubtitleMode;
    videoSubtitleSettings.bilingualMode = settings.videoBilingualMode;
    
    if (videoSubtitleSettings.enabled) {
        observeVideos();
    }
});

// Listen for settings updates
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateVideoSettings') {
        videoSubtitleSettings = { ...videoSubtitleSettings, ...request.settings };
        
        if (videoSubtitleSettings.enabled) {
            observeVideos();
        } else {
            // Clean up all video subtitles
            document.querySelectorAll('video').forEach(video => {
                cleanupVideoSubtitles(video);
            });
        }
        
        sendResponse({ success: true });
    }
});

// Observe DOM for new video elements
const videoMutationObserver = new MutationObserver((mutations) => {
    if (!videoSubtitleSettings.enabled) return;
    
    let hasNewVideos = false;
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeName === 'VIDEO' || 
                    (node.nodeType === Node.ELEMENT_NODE && node.querySelector && node.querySelector('video'))) {
                    hasNewVideos = true;
                }
            });
        }
    });
    
    if (hasNewVideos) {
        observeVideos();
    }
});

videoMutationObserver.observe(document.body, {
    childList: true,
    subtree: true
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title', 'placeholder', 'alt', 'value']
});