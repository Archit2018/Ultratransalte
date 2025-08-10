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
    interfaceLanguage: 'en'
}, (settings) => {
    currentSettings = settings;
    if (settings.autoTranslate && shouldTranslatePage()) {
        setTimeout(() => translatePage(settings), 2000);
    }
});

// Check if page should be translated
function shouldTranslatePage() {
    // Skip if page is already in target language
    const pageLang = document.documentElement.lang?.toLowerCase();
    if (pageLang && pageLang.startsWith(currentSettings.targetLanguage.toLowerCase().substring(0, 2))) {
        return false;
    }
    
    // Check excluded sites
    const excludedSites = currentSettings.excludedSites?.split('\n').filter(s => s.trim());
    if (excludedSites?.some(site => window.location.href.includes(site.trim()))) {
        return false;
    }
    
    return true;
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
                    'textarea', 'input', 'select', 'option' // Form elements
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
const throttledTranslate = debounce(() => {
    if (!currentSettings.autoTranslate || isTranslating) return;
    
    const newTextNodes = getTextNodes(document.body);
    if (newTextNodes.length > 0) {
        const optimizedBatches = createOptimizedBatches(newTextNodes, currentSettings);
        optimizedBatches.forEach(batch => translateBatch(batch, currentSettings));
    }
}, 1500);

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
    
    let hasNewText = false;
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE || 
                    (node.nodeType === Node.ELEMENT_NODE && node.textContent?.trim())) {
                    // Skip if already translated
                    if (node.classList && 
                        (node.classList.contains('ultra-translate-wrapper') || 
                         node.classList.contains('ultra-translate-translated'))) {
                        return;
                    }
                    hasNewText = true;
                }
            });
        }
    });
    
    if (hasNewText) {
        throttledTranslate();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});