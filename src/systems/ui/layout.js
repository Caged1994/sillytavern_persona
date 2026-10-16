/**
 * Layout Management Module
 * Handles section visibility (panel has been removed — data renders via scene headers)
 */
import {
    extensionSettings,
    $infoBoxContainer,
    $thoughtsContainer,
    $questsContainer,
    lastGeneratedData,
    committedTrackerData
} from '../../core/state.js';

/**
 * Updates the visibility of individual sections.
 * Note: With the panel removed, these containers may not exist in DOM.
 * This function is kept for compatibility with settings toggle handlers.
 */
/**
 * Closes the mobile settings panel with a slide-out animation.
 */
export function closeMobilePanelWithAnimation() {
    const $panel = $('#rpg-panel');
    const $overlay = $('#rpg-mobile-overlay');
    const $toggle = $('#rpg-mobile-toggle');
    $panel.removeClass('rpg-mobile-open');
    $overlay.removeClass('active');
    $toggle.removeClass('active');
}

/**
 * Updates the collapse toggle icon based on current panel state.
 */
export function updateCollapseToggleIcon() {
    const $toggle = $('#rpg-collapse-toggle i');
    const $panel = $('#rpg-panel');
    if ($panel.hasClass('rpg-collapsed')) {
        $toggle.removeClass('fa-chevron-up').addClass('fa-chevron-down');
    } else {
        $toggle.removeClass('fa-chevron-down').addClass('fa-chevron-up');
    }
}

export function updateSectionVisibility() {
    if ($infoBoxContainer) {
        if (extensionSettings.showInfoBox) {
            const infoBoxData = lastGeneratedData.infoBox || committedTrackerData.infoBox;
            if (infoBoxData) {
                $infoBoxContainer.show();
            } else {
                $infoBoxContainer.hide();
            }
        } else {
            $infoBoxContainer.hide();
        }
    }
    if ($thoughtsContainer) {
        if (extensionSettings.showCharacterThoughts) {
            $thoughtsContainer.show();
        } else {
            $thoughtsContainer.hide();
        }
    }
    if (extensionSettings.showQuests) {
        $('#rpg-quests').show();
    } else {
        $('#rpg-quests').hide();
    }
}
