#!/bin/bash
set -e

# ==============================================================================
# scripts/sign-local.sh
# Sign Termi with a Free Personal Apple ID Certificate ($0)
# ==============================================================================

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}======================================================${RESET}"
echo -e "${BOLD}${CYAN}   Termi Free Local Code Signing Tool                 ${RESET}"
echo -e "${BOLD}${CYAN}======================================================${RESET}\n"

# Parse arguments:
# Usage:
#   npm run app:sign:local
#   npm run app:sign:local -- "personal_email@domain.com"
#   npm run app:sign:local -- /Applications/Termi.app "personal_email@domain.com"
TARGET_APP="/Applications/Termi.app"
FILTER_QUERY="${APPLE_SIGNING_IDENTITY:-}"

if [[ -n "$1" ]]; then
    if [[ "$1" == *.app || -d "$1" ]]; then
        TARGET_APP="$1"
        FILTER_QUERY="${2:-$FILTER_QUERY}"
    else
        FILTER_QUERY="$1"
    fi
fi

if [[ ! -d "$TARGET_APP" ]]; then
    if [[ -d "./src-tauri/target/release/bundle/macos/Termi.app" ]]; then
        TARGET_APP="./src-tauri/target/release/bundle/macos/Termi.app"
    elif [[ -d "$HOME/Applications/Termi.app" ]]; then
        TARGET_APP="$HOME/Applications/Termi.app"
    else
        echo -e "${RED}Error: App bundle not found at: $TARGET_APP${RESET}"
        echo -e "Please build or install Termi to /Applications first."
        exit 1
    fi
fi

# Discover available Apple Development identities
RAW_IDENTITIES=$(security find-identity -p codesigning -v 2>/dev/null | grep "Apple Development" || true)

if [[ -z "$RAW_IDENTITIES" ]]; then
    echo -e "${YELLOW}No Apple Development signing identity was detected in Keychain.${RESET}\n"
    echo -e "${BOLD}How to create your FREE Personal Certificate in Xcode (\$0, no paid account):${RESET}"
    echo -e " 1. Open ${BOLD}Xcode${RESET} -> ${BOLD}Settings (or Preferences)${RESET} -> ${BOLD}Accounts${RESET}."
    echo -e " 2. Select your ${BOLD}Personal Apple ID${RESET} on the left."
    echo -e " 3. On the right, select your ${BOLD}Personal Team${RESET} (e.g. 'Your Name (Personal Team)')."
    echo -e " 4. Click ${BOLD}Manage Certificates...${RESET} (bottom right)."
    echo -e " 5. Click ${BOLD}[+]${RESET} (bottom left) -> ${BOLD}Apple Development${RESET}."
    echo -e " 6. Click ${BOLD}Done${RESET}, then re-run: ${BOLD}npm run app:sign:local${RESET}\n"
    exit 1
fi

# Parse identities into an array
MATCHED_IDENTITIES=()
while IFS= read -r line; do
    if [[ "$line" =~ \"([^\"]+)\" ]]; then
        id_name="${BASH_REMATCH[1]}"
        if [[ -n "$FILTER_QUERY" ]]; then
            if echo "$id_name" | grep -iq "$FILTER_QUERY"; then
                MATCHED_IDENTITIES+=("$id_name")
            fi
        else
            MATCHED_IDENTITIES+=("$id_name")
        fi
    fi
done <<< "$RAW_IDENTITIES"

if [[ -n "$FILTER_QUERY" && ${#MATCHED_IDENTITIES[@]} -eq 0 ]]; then
    echo -e "${RED}Error: No identity matched filter: \"$FILTER_QUERY\"${RESET}\n"
    echo -e "Available identities in Keychain:"
    echo "$RAW_IDENTITIES"
    echo -e "\nExample: ${BOLD}npm run app:sign:local -- \"your_personal_email@domain.com\"${RESET}"
    exit 1
fi

SELECTED_IDENTITY=""

if [[ ${#MATCHED_IDENTITIES[@]} -eq 1 ]]; then
    SELECTED_IDENTITY="${MATCHED_IDENTITIES[0]}"
elif [[ ${#MATCHED_IDENTITIES[@]} -gt 1 ]]; then
    echo -e "${CYAN}Multiple Apple Development identities found:${RESET}"
    for i in "${!MATCHED_IDENTITIES[@]}"; do
        idx=$((i + 1))
        echo -e "  [${idx}] ${MATCHED_IDENTITIES[$i]}"
    done

    # Check if interactive terminal
    if [ -t 0 ]; then
        echo -ne "\nSelect which identity to use (1-${#MATCHED_IDENTITIES[@]}) [default 1]: "
        read -r choice
        choice="${choice:-1}"
        array_index=$((choice - 1))
        if [[ $array_index -ge 0 && $array_index -lt ${#MATCHED_IDENTITIES[@]} ]]; then
            SELECTED_IDENTITY="${MATCHED_IDENTITIES[$array_index]}"
        else
            echo -e "${RED}Invalid choice. Defaulting to first identity.${RESET}"
            SELECTED_IDENTITY="${MATCHED_IDENTITIES[0]}"
        fi
    else
        echo -e "\n${YELLOW}Non-interactive shell: defaulting to first matching identity.${RESET}"
        echo -e "Tip: Specify your personal account by passing your email or team ID:"
        echo -e "     ${BOLD}npm run app:sign:local -- \"personal@email.com\"${RESET}\n"
        SELECTED_IDENTITY="${MATCHED_IDENTITIES[0]}"
    fi
fi

echo -e "\n${BOLD}Target App:${RESET}      $TARGET_APP"
echo -e "${BOLD}Signing Identity:${RESET} $SELECTED_IDENTITY\n"

echo -e "${CYAN}Signing app bundle with runtime options...${RESET}"
codesign --force --deep --options runtime --sign "$SELECTED_IDENTITY" "$TARGET_APP"

echo -e "\n${CYAN}Verifying signature...${RESET}"
codesign -vvv --deep --strict "$TARGET_APP"

echo -e "\n${CYAN}Designated Requirement:${RESET}"
codesign -d -r- "$TARGET_APP"

echo -e "\n${BOLD}${GREEN}======================================================${RESET}"
echo -e "${BOLD}${GREEN}✓ Successfully signed Termi with personal certificate!${RESET}"
echo -e "Your Full Disk Access and folder permissions will now"
echo -e "permanently persist across rebuilds and updates."
echo -e "${BOLD}${GREEN}======================================================${RESET}\n"
