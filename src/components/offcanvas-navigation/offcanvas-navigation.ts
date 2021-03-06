import * as $ from 'jquery';

import requireAsync from 'utils/require-async';
import idleDeffered, {
    default as idleDeferred,
    IdleDeferred,
} from 'utils/idle-deffered';

/**
 * Component options interface.
 */
export interface OffcanvasNavigationOptions {
    className?: string;
    navigationClassName?: string;
    drawerClassName?: string;
    languageSwitcherSelector?: string;
    currencySwitcherSelector?: string;
    showCategoryIcon?: boolean;
    showProductsCount?: boolean;
    localStorageKey?: string;
    endpointPath?: string;
    authorizationLinkSelector?: string;
    showActiveCategoryLevel?: boolean;
    highlightActiveCategory?: boolean;
    activeCategoryHighlightClass?: string;
    onNavigationRender?: () => void; // Callback to fire when navigation is rendered
}

interface OffcanvasNavigationCache {
    key?: string;
    generationTime?: number;
    html?: string;
}

interface MainNavigationCacheInfo {
    url: string;
    key: string;
    generationTime: number;
}

/**
 * Offcanvas navigation component responsible for multilevel offcanvas navigation menu.
 */
export default class OffcanvasNavigation {
    protected _options: OffcanvasNavigationOptions;
    protected _$element: JQuery;
    protected _$drawer: JQuery;
    protected _$parentLink: JQuery;
    protected _$returnLink: JQuery;
    protected _idleDeferred: IdleDeferred;
    protected _activeCategoryPath: string[];

    protected _eventListeners: {
        offcanvasShow?: (event: JQuery.Event) => void;
        offcanvasHide?: (event: JQuery.Event) => void;
        parentLinkClick?: (event: JQuery.Event) => void;
        returnLinkClick?: (event: JQuery.Event) => void;
    } = {};

    /**
     * Creates offcanvas navigation with optional settings.
     * @param options Optional settings for a component.
     */
    public constructor(options?: OffcanvasNavigationOptions) {
        this._options = $.extend(
            {
                className: 'cs-offcanvas-navigation',
                navigationClassName: 'cs-navigation',
                drawerClassName: 'cs-offcanvas__drawer',
                showCategoryIcon: false,
                showProductsCount: false,
                localStorageKey: 'mgs-offcanvas-navigation',
                cacheTTL: 60 * 60,
                endpointPath: '/navigation/mobile/index',
                currencySwitcherSelector: '.switcher-currency',
                languageSwitcherSelector: '.switcher-language',
                authorizationLinkSelector: '.authorization-link',
                showActiveCategoryLevel: true,
                highlightActiveCategory: false,
                activeCategoryHighlightClass: `active`,
            },
            options
        );

        this._$drawer = $(`.${this._options.drawerClassName}`);
        if (!this._$drawer.length) {
            return;
        }

        // Read active category path from a special tag.
        // Template literal used to always get data attribute as a string
        this._activeCategoryPath = `${$('#active-category-path').data(
            'activeCategoryPath'
        )}`.split('/');

        this._initWhenIdle();
    }

    /**
     * Initializes offcanvas navigation either from cache or when browser enters idle state.
     */
    protected _initWhenIdle(): void {
        this._idleDeferred = idleDeferred();
        this._idleDeferred
            .then(() => this._getHtml())
            .then(html => this._initHtml(html))
            .then(() => {
                if (this._options.showActiveCategoryLevel) {
                    this._showActiveCategoryLevel();
                }

                if (this._options.highlightActiveCategory) {
                    this._highlightActiveCategoryItem();
                }

                if (this._options.onNavigationRender) {
                    this._options.onNavigationRender();
                }
            });
    }

    /**
     * Forces offcanvas navigation initialization without waiting for browser idle period.
     */
    protected _forceInit(): void {
        if (this._idleDeferred) {
            this._idleDeferred.force();
        }
    }

    /**
     * Initializes given HTML and assigns all event listeners.
     * @param html Offcanvas navigation HTML loaded with AJAX or from cache.
     */
    protected _initHtml(html: string): void {
        this._$element = $(html);
        this._$drawer.empty().append(this._$element);

        this._$parentLink = this._$element.find(
            `.${this._options.className}__link--parent`
        );
        this._$returnLink = this._$element.find(
            `.${this._options.className}__link--return`
        );

        this._addEventListeners();
        this._initSwitchers();
        this._fixLoginLinks();
    }

    /**
     * Initializes language and currency switchers.
     */
    protected _initSwitchers(): void {
        const $offcanvasLanguageSwitcher: JQuery = this._$drawer.find(
            this._options.languageSwitcherSelector
        );
        this._fixSwitcherLinks($offcanvasLanguageSwitcher);

        const $offcanvasCurrencySwitcher: JQuery = this._$drawer.find(
            this._options.currencySwitcherSelector
        );

        this._fixSwitcherLinks($offcanvasCurrencySwitcher);

        requireAsync(['mage/apply/main']).then(([mage]) => mage.apply());
    }

    /**
     * Fixes links in given switchers caused by them being generated under async URL.
     * @param $offcanvasSwitcher Reference to switcher inside offcanvas.
     */
    protected _fixSwitcherLinks($offcanvasSwitcher: JQuery) {
        const uenc = btoa(window.location.href);
        $offcanvasSwitcher.find('a').each((index, element) => {
            const $switcherLink = $(element);
            const postData = $switcherLink.data('post');
            postData.data.uenc = uenc;
            $switcherLink.attr('data-post', JSON.stringify(postData));
        });
    }

    /**
     * Fixes login link URL caused by using AJAX endpoint and invalid referer.
     */
    protected _fixLoginLinks() {
        const $offcanvasLoginLink = this._$drawer.find(
            `.${this._options.className}__link--sign-in`
        );

        if ($offcanvasLoginLink.length) {
            $offcanvasLoginLink.attr(
                'href',
                $offcanvasLoginLink
                    .attr('href')
                    .replace(
                        /referer\/[^\/]+\//,
                        `referer/${btoa(window.location.href)}/`
                    )
            );
        }
    }

    /**
     * Fetches navigation HTML from cache or using AJAX from endpoint.
     * @param url AJAX endpoint URL.
     */
    protected _getHtml(): JQuery.Deferred<string> {
        const deferred = jQuery.Deferred();
        const cacheInfo = this._getCacheInfo();
        const cache = this._loadCache();

        if (!cacheInfo.url) {
            /* tslint:disable */
            console.error(
                `Main navigation is missing "data-mobile-endpoint-url" attribute, please make sure its template is up to date.`
            );
            /* tslint:enable */
            return deferred.resolve('');
        }

        if (
            cache.key === cacheInfo.key &&
            cache.generationTime >= cacheInfo.generationTime
        ) {
            return deferred.resolve(cache.html);
        }

        $.get(cacheInfo.url, { cache_key: cacheInfo.key }).then(
            (html: string) => {
                this._setCache(cacheInfo.key, html);
                deferred.resolve(html);
            }
        );

        return deferred;
    }

    protected _loadCache(): OffcanvasNavigationCache {
        const cache = {};
        try {
            $.extend(
                cache,
                JSON.parse(localStorage.getItem(this._options.localStorageKey))
            );
        } catch (error) {
            // tslint:disable-next-line
            console.error(error);
            // Cache may be corrupted from previous implementation.
            localStorage.removeItem(this._options.localStorageKey);
        }

        return cache;
    }

    protected _setCache(key: string, html: string) {
        const cache: OffcanvasNavigationCache = {
            key: key,
            html: html,
            generationTime: Math.floor(Date.now() / 1000),
        };

        try {
            localStorage.setItem(
                this._options.localStorageKey,
                JSON.stringify(cache)
            );
        } catch (error) {
            // tslint:disable-next-line
            console.error(error);
        }
    }

    protected _getCacheInfo(): MainNavigationCacheInfo {
        const $navigation = $(`.${this._options.navigationClassName}`);

        return {
            url: $navigation.data('mobile-endpoint-url'),
            key: $navigation.data('cache-key'),
            generationTime: $navigation.data('cache-generation-time'),
        };
    }

    /**
     * Handles parent link click
     * @param {Event} event [description]
     */
    protected _handleParentLinkClick(event: Event): void {
        event.preventDefault();

        const categoryToShow = $(event.target).hasClass(
            `${this._options.className}__link--parent`
        )
            ? $(event.target).data('category-id')
            : $(event.target)
                  .parents(`.${this._options.className}__link--parent`)
                  .first()
                  .data('category-id');

        this._showCategoryLevel(categoryToShow);
    }

    /**
     * Shows navigation level list.
     * @param {jQuery} $levelToShow ${this._options.className}__list element which should be shown.
     */
    protected _showCategoryLevel(categoryId: string): void {
        const $currentLevel = $(`.${this._options.className}__list--current`);

        const $listToShow = $(`
            .${this._options.className}__link[data-category-id="${categoryId}"]
        `).next();

        if ($currentLevel.length > 0) {
            $currentLevel.animate({ scrollTop: 0 }, 'fast', () => {
                $currentLevel.removeClass(
                    `${this._options.className}__list--current`
                );
                $listToShow
                    .addClass(
                        `
                        ${this._options.className}__list--active
                        ${this._options.className}__list--current
                    `
                    )
                    .parents(`.${this._options.className}__list`)
                    .each((i, parent) => {
                        $(parent).addClass(
                            `${this._options.className}__list--active`
                        );
                    });
            });
        } else {
            $listToShow
                .addClass(
                    `
                    ${this._options.className}__list--active
                    ${this._options.className}__list--current
                `
                )
                .parents(`.${this._options.className}__list`)
                .each((i, parent) => {
                    $(parent).addClass(
                        `${this._options.className}__list--active`
                    );
                });
        }
    }

    /**
     * Hides current navigation level based on clicked return link.
     * @param {Event} event [description]
     */
    protected _hideLevel(event: Event): void {
        event.preventDefault();
        const $levelToHide = $(event.target).closest(
            `.${this._options.className}__list`
        );
        $levelToHide
            .removeClass(
                `
                ${this._options.className}__list--active
                ${this._options.className}__list--current
            `
            )
            .parent()
            .closest(`.${this._options.className}__list`)
            .addClass(`${this._options.className}__list--current`);
    }
    /**
     * Resets levels to root.
     */
    protected _resetLevels(): void {
        const $levelsToHide = this._$element.find(
            `.${this._options.className}__list`
        );
        // Reset all levels.
        $levelsToHide.removeClass(
            `${this._options.className}__list--active ${this._options.className}__list--current`
        );

        if (this._options.showActiveCategoryLevel) {
            this._showActiveCategoryLevel();
        } else {
            // Set root level to current.
            $levelsToHide
                .eq(0)
                .addClass(`${this._options.className}__list--current`);
        }
    }
    /**
     * Sets up event listeners for a component.
     */
    protected _addEventListeners(): void {
        this._eventListeners.offcanvasShow = this._forceInit.bind(this);
        $(document).on('offcanvas-show', this._eventListeners.offcanvasShow);

        this._eventListeners.offcanvasHide = this._resetLevels.bind(this);
        $(document).on('offcanvas-hide', this._eventListeners.offcanvasHide);

        this._eventListeners.parentLinkClick = this._handleParentLinkClick.bind(
            this
        );
        this._$parentLink.on('click', this._eventListeners.parentLinkClick);

        this._eventListeners.returnLinkClick = this._hideLevel.bind(this);
        this._$returnLink.on('click', this._eventListeners.returnLinkClick);
    }
    /**
     * Removes event listeners for a component.
     */
    protected _removeEventListeners(): void {
        $(document).off('offcanvas-show', this._eventListeners.offcanvasShow);
        $(document).off('offcanvas-hide', this._eventListeners.offcanvasHide);
        this._$parentLink.off('click', this._eventListeners.parentLinkClick);
        this._$returnLink.off('click', this._eventListeners.returnLinkClick);
    }
    /**
     * Shows current category level in navigation (or parent category level if there is no nested category).
     */
    protected _showActiveCategoryLevel(): void {
        if (this._activeCategoryPath.length <= 1) {
            return;
        }

        const activeCategoryId = this._activeCategoryPath[
            this._activeCategoryPath.length - 1
        ];
        const $activeCategoryLink = $(
            `.${this._options.className}__link[data-category-id="${activeCategoryId}"]`
        );

        if (
            $activeCategoryLink.hasClass(
                `${this._options.className}__link--parent`
            )
        ) {
            this._showCategoryLevel(activeCategoryId);
        } else {
            const parentCategoryId = this._activeCategoryPath[
                this._activeCategoryPath.length - 2
            ];
            this._showCategoryLevel(parentCategoryId);
        }
    }
    /**
     * Adds highlight classname to active category list item
     */
    protected _highlightActiveCategoryItem(): void {
        if (this._activeCategoryPath.length) {
            const activeCategoryId = this._activeCategoryPath[
                this._activeCategoryPath.length - 1
            ];
            const $activeCategoryItem = $(
                `.${this._options.className}__link[data-category-id="${activeCategoryId}"]`
            )
                .parent()
                .addClass(this._options.activeCategoryHighlightClass);
        }

        const activeCategoryId = this._activeCategoryPath[
            this._activeCategoryPath.length - 1
        ];
        const $activeCategoryLink = $(
            `.${this._options.className}__link[data-category-id="${activeCategoryId}"]`
        );

        if (
            $activeCategoryLink.hasClass(
                `${this._options.className}__link--parent`
            )
        ) {
            this._showCategoryLevel(activeCategoryId);
        } else {
            const parentCategoryId = this._activeCategoryPath[
                this._activeCategoryPath.length - 2
            ];
            this._showCategoryLevel(parentCategoryId);
        }
    }
}
