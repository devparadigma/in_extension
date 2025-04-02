// ==UserScript==
// @name         InPlay Schedule Collector
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Собирает данные о спортивных событиях с api.inplayip.tv и отправляет на указанный сервер
// @author       Click Clack
// @match        https://inplayip.tv/*
// @match        https://api.inplayip.tv/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      inplayip.net
// @connect      api.inplayip.tv
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function() {
    'use strict';

    // Конфигурация
    const CONFIG = {
        SOURCE_API: "https://api.inplayip.tv/api/schedule/table",
        TARGET_API: "https://sportarena.win/collector",
        AUTH_KEY: "Basic " + btoa("inplay:8J9k3aEmertR"),
        MAX_PAGES: 1, // Сколько дней вперёд проверять
        CACHE_TTL_HOURS: 24, // Время хранения кэша (в часах)
        DEBUG: true // Логировать действия в консоль
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
            GM_deleteValue(this.PREFIX + key); // Автоочистка просроченного
            return null;
        }
    };

    // Логирование
    function log(message, isError = false) {
        if (!CONFIG.DEBUG) return;
        const style = isError ? "color: red;" : "color: green;";
        console.log(`%c[InPlay] ${message}`, style);
    }

    // Перехват заголовков из запроса к stream_settings_aliases
    let interceptedHeaders = null;

    XMLHttpRequest.prototype.originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this.originalOpen.apply(this, arguments);
        if (url.includes('stream_settings_aliases')) {
            this.addEventListener('load', () => {
                if (this.status === 200) {
                    interceptedHeaders = this.headers;
                    log("Заголовки перехвачены, начинаем сбор данных...");
                    fetchAllSchedules();
                }
            });
        }
    };

    // Сбор данных с пагинацией
    async function fetchAllSchedules() {
        const allEvents = [];
        for (let day = 0; day < CONFIG.MAX_PAGES; day++) {
            const date = new Date();
            date.setDate(date.getDate() + day);
            const dateKey = date.toISOString().split('T')[0];
            
            // Проверка кэша
            const cachedData = Storage.get(dateKey);
            if (cachedData) {
                log(`Данные за ${dateKey} взяты из кэша`);
                allEvents.push(...cachedData);
                continue;
            }

            // Запрос к API
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
                if (data && data.length > 0) {
                    Storage.set(dateKey, data, CONFIG.CACHE_TTL_HOURS * 3600);
                    allEvents.push(...data);
                    log(`Данные за ${dateKey} успешно получены`);
                }
            } catch (error) {
                log(`Ошибка при запросе за ${dateKey}: ${error.message}`, true);
            }
        }

        if (allEvents.length > 0) {
            sendToTarget(allEvents);
        } else {
            log("Нет данных для отправки", true);
        }
    }

    // Отправка данных на целевой сервер
    function sendToTarget(data) {
        GM_xmlhttpRequest({
            method: "POST",
            url: CONFIG.TARGET_API,
            headers: {
                "Authorization": CONFIG.AUTH_KEY,
                "Content-Type": "application/json"
            },
            data: JSON.stringify(data),
            onload: function(response) {
                if (response.status === 200) {
                    log(`Данные успешно отправлены (${data.length} событий)`);
                } else {
                    log(`Ошибка отправки: ${response.status}`, true);
                }
            },
            onerror: function(error) {
                log(`Ошибка сети: ${error}`, true);
            }
        });
    }

    // Универсальный запрос (для примера, в реальности используйте fetch/GM_xmlhttpRequest)
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
                onload: function(response) {
                    if (response.status === 200) {
                        resolve(JSON.parse(response.responseText));
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                onerror: reject
            });
        });
    }

    log("Скрипт инициализирован и ожидает данных...");
})();
