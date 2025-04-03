// ==UserScript==
// @name         InPlay Schedule Collector
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Собирает данные о спортивных событиях с api.inplayip.tv
// @author       Click Clack
// @match        https://www.inplayip.tv/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      sportarena.win
// @connect      api.inplayip.tv
// @run-at       document-start
// @updateURL    https://github.com/devparadigma/in_extension/raw/main/collector.user.js
// @downloadURL  https://github.com/devparadigma/in_extension/raw/main/collector.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Конфигурация
    const CONFIG = {
        SOURCE_API: "https://api.inplayip.tv/api/schedule/table",
        TARGET_API: "https://sportarena.win/collector",
        MAX_PAGES: 1,
        CACHE_TTL_HOURS: 24,
        DEBUG: true
    };

    // Кэширование данных
    const Storage = {
        PREFIX: "GM_data_",
        set(key, value, ttlSeconds = null) {
            const data = { v: value };
            if (ttlSeconds) data.e = Date.now() + ttlSeconds * 1000;
            GM_setValue(this.PREFIX + key, data);
        },
        get(key) {
            const entry = GM_getValue(this.PREFIX + key);
            if (entry && (!entry.e || entry.e > Date.now())) {
                return entry.v;
            }
            GM_deleteValue(this.PREFIX + key);
            return null;
        }
    };

    // Логирование
    function log(message, isError = false) {
        if (!CONFIG.DEBUG) return;
        console.log(`[InPlay] ${isError ? 'Ошибка:' : ''} ${message}`);
    }

    // Перехват заголовков
    let interceptedHeaders = null;

    XMLHttpRequest.prototype.originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this.originalOpen.apply(this, arguments);
        if (url.includes('stream_settings_aliases')) {
            this.addEventListener('load', () => {
                if (this.status === 200) {
                    interceptedHeaders = this.headers;
                    log("Заголовки перехвачены");
                    fetchAllSchedules();
                }
            });
        }
    };

    // Сбор данных
    async function fetchAllSchedules() {
        const allEvents = [];
        for (let day = 0; day < CONFIG.MAX_PAGES; day++) {
            const date = new Date();
            date.setDate(date.getDate() + day);
            const dateKey = date.toISOString().split('T')[0];
            
            if (const cachedData = Storage.get(dateKey)) {
                log(`Данные за ${dateKey} из кэша`);
                allEvents.push(...cachedData);
                continue;
            }

            const requestBody = {
                filters: {
                    searchDate: date.toISOString(),
                    searchWord: "",
                    onlyNew: false,
                    showVOD: false,
                    showLive: false,
                    sportsCriteria: [],
                    countriesCriteria: [],
                    servicesCriteria: []
                },
                timezoneOffset: 0
            };

            try {
                const data = await makeRequest(CONFIG.SOURCE_API, requestBody);
                if (data?.length > 0) {
                    Storage.set(dateKey, data, CONFIG.CACHE_TTL_HOURS * 3600);
                    allEvents.push(...data);
                }
            } catch (error) {
                log(`Ошибка запроса: ${error.message}`, true);
            }
        }

        if (allEvents.length > 0) {
            sendToTarget(allEvents);
        }
    }

    // Отправка данных
    function sendToTarget(data) {
        GM_xmlhttpRequest({
            method: "POST",
            url: CONFIG.TARGET_API,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify(data),
            onload: (response) => {
                log(response.status === 200 
                    ? `Отправлено ${data.length} событий` 
                    : `Ошибка: ${response.status}`);
            },
            onerror: (error) => {
                log(`Ошибка сети: ${error}`, true);
            }
        });
    }

    // Универсальный запрос
    function makeRequest(url, body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: {
                    ...interceptedHeaders,
                    "Content-Type": "application/json"
                },
                data: JSON.stringify(body),
                onload: (response) => {
                    response.status === 200 
                        ? resolve(JSON.parse(response.responseText)) 
                        : reject(new Error(`HTTP ${response.status}`));
                },
                onerror: reject
            });
        });
    }

    log("Скрипт активирован");
})();
