// ==UserScript==
// @name         InPlay Schedule Collector (Enhanced)
// @namespace    https://sportarena.win
// @version      1.4
// @description  Improved version with better caching and request handling
// @author       Click Clack
// @match        https://www.inplayip.tv/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=inplayip.tv
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      api.inplayip.tv
// @connect      sportarena.win
// @run-at       document-end
// @updateURL    https://github.com/devparadigma/in_extension/raw/main/collector.user.js
// @downloadURL  https://github.com/devparadigma/in_extension/raw/main/collector.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Улучшенное хранилище с TTL и управлением ключами
    class AdvancedStorage {
        constructor() {
            this.prefix = 'GM_data_';
            this.keyList = 'GM_dataKeys';
            // Автоочистка при инициализации
            this.getKeys().forEach(key => {
                const entry = this.get(key, {});
                if (entry.e !== undefined && !this.checkExpiryTime(entry.e)) {
                    this.delete(key);
                }
            });
        }

        getKeys() {
            return GM_getValue(this.keyList, []).filter(key => {
                const entry = GM_getValue(this.prefix + key);
                return typeof entry === 'object' && entry?.v !== undefined;
            });
        }

        set(key, value, ttlSeconds = null) {
            const entry = { v: value };
            if (ttlSeconds) entry.e = Date.now() + ttlSeconds * 1000;
            
            GM_setValue(this.prefix + key, entry);
            const keys = this.getKeys();
            if (!keys.includes(key)) {
                GM_setValue(this.keyList, [...keys, key]);
            }
        }

        get(key, defaultValue = null) {
            const entry = GM_getValue(this.prefix + key);
            if (!entry || (entry.e !== undefined && !this.checkExpiryTime(entry.e))) {
                this.delete(key);
                return defaultValue;
            }
            return entry?.v ?? defaultValue;
        }

        delete(key) {
            const keys = this.getKeys().filter(k => k !== key);
            GM_setValue(this.keyList, keys);
            GM_deleteValue(this.prefix + key);
        }

        checkExpiryTime(expiryTimestamp) {
            return Date.now() < expiryTimestamp;
        }

        logContents() {
            console.group('Storage Contents');
            this.getKeys().forEach(key => {
                const entry = GM_getValue(this.prefix + key);
                console.log(`${key}:`, entry);
            });
            console.groupEnd();
        }
    }

    const CONFIG = {
        TARGET_API: "https://sportarena.win/collector",
        CACHE_TTL_HOURS: 1,
        MAX_RETRIES: 3,
        RETRY_DELAY: 1000,
        DEBUG: true
    };

    const storage = new AdvancedStorage();
    let apiHeaders = null;

    // Логирование с проверкой режима отладки
    function log(message, isError = false) {
        if (!CONFIG.DEBUG) return;
        const method = isError ? console.error : console.log;
        method(`[InPlay] ${message}`);
    }

    // Перехват заголовков API
    function setupHeaderInterceptor() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.headers = {};

        XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
            this.headers[name] = value;
            return originalSetRequestHeader.apply(this, arguments);
        };

        XMLHttpRequest.prototype.open = function() {
            this.addEventListener('readystatechange', function() {
                if (this.readyState === 4 && this.status === 200) {
                    if (this.responseURL.includes('/api/schedule/stream_settings_aliases')) {
                        apiHeaders = this.headers;
                        log('API headers captured', apiHeaders);
                        fetchSchedule();
                    }
                }
            });
            return originalOpen.apply(this, arguments);
        };
    }

    // Запрос с повторными попытками
    async function makeRequest(url, headers, body, retries = CONFIG.MAX_RETRIES) {
        try {
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: url,
                    headers: headers,
                    data: JSON.stringify(body),
                    onload: resolve,
                    onerror: reject
                });
            });

            if (response.status === 200) {
                return JSON.parse(response.responseText);
            }
            throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            if (retries > 0) {
                log(`Retrying... (${retries} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
                return makeRequest(url, headers, body, retries - 1);
            }
            throw error;
        }
    }

    // Загрузка данных за несколько дней
    async function fetchMultipleDays(daysToFetch) {
        const results = [];
        const currentDate = new Date();

        for (let i = 0; i < daysToFetch; i++) {
            const date = new Date(currentDate);
            date.setDate(date.getDate() + i);
            const dateKey = date.toISOString().split('T')[0];
            const cacheKey = `schedule_${dateKey}`;

            // Проверка кэша
            const cachedData = storage.get(cacheKey);
            if (cachedData) {
                log(`Using cached data for ${dateKey}`);
                results.push(...cachedData);
                continue;
            }

            try {
                const requestBody = {
                    filters: {
                        searchDate: date.toISOString(),
                        searchWord: "",
                        onlyNew: false,
                        showVOD: false,
                        showLive: true,
                        sportsCriteria: [],
                        countriesCriteria: [],
                        servicesCriteria: []
                    },
                    timezoneOffset: 0
                };

                const data = await makeRequest(
                    'https://api.inplayip.tv/api/schedule/table',
                    apiHeaders,
                    requestBody
                );

                if (data?.length > 0) {
                    storage.set(cacheKey, data, CONFIG.CACHE_TTL_HOURS * 3600);
                    results.push(...data);
                }
            } catch (error) {
                log(`Failed to fetch data for ${dateKey}: ${error.message}`, true);
            }
        }

        return results;
    }

    // Отправка данных на целевой сервер
    function sendToTarget(data) {
        if (!data || data.length === 0) {
            log('No data to send', true);
            return;
        }

        GM_xmlhttpRequest({
            method: "POST",
            url: CONFIG.TARGET_API,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify(data),
            onload: function(response) {
                log(`Data sent (${data.length} items), status: ${response.status}`);
            },
            onerror: function(error) {
                log(`Failed to send data: ${error}`, true);
            }
        });
    }

    // Основная функция сбора данных
    async function fetchSchedule() {
        if (!apiHeaders) {
            log('API headers not available yet', true);
            return;
        }

        try {
            const data = await fetchMultipleDays(1);
            if (data.length > 0) {
                sendToTarget(data);
            } else {
                log('No schedule data found', true);
            }
        } catch (error) {
            log(`Schedule fetch failed: ${error.message}`, true);
        }
    }

    // Инициализация
    function init() {
        setupHeaderInterceptor();
        log('Script initialized');

        // Периодическая проверка на случай если перехват не сработал
        let checkCount = 0;
        const checkInterval = setInterval(() => {
            if (apiHeaders) {
                clearInterval(checkInterval);
                return;
            }
            
            checkCount++;
            if (checkCount >= 5) {
                clearInterval(checkInterval);
                log('Failed to capture API headers after 5 attempts', true);
            }
        }, 2000);
    }

    // Запуск после полной загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
