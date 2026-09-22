#!/bin/bash
set -e

# ==============================================================================
# scripts/setup-macos-permissions.sh
# Automated Full Disk Access (FDA) helper & identity checker for Termi
# ==============================================================================

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
BLUE="\033[34m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}======================================================${RESET}"
echo -e "${BOLD}${CYAN}   Termi macOS Permissions & Full Disk Access Setup   ${RESET}"
echo -e "${BOLD}${CYAN}======================================================${RESET}\n"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo -e "${RED}Error: This script is only intended for macOS.${RESET}"
    exit 1
fi

APP_PATH="/Applications/Termi.app"
if [[ ! -d "$APP_PATH" ]]; then
    if [[ -d "$HOME/Applications/Termi.app" ]]; then
        APP_PATH="$HOME/Applications/Termi.app"
    elif [[ -d "./src-tauri/target/release/bundle/macos/Termi.app" ]]; then
        APP_PATH="./src-tauri/target/release/bundle/macos/Termi.app"
    fi
fi

echo -e "${BOLD}1. Checking Full Disk Access (FDA) status...${RESET}"
if test -r "$HOME/Library/Safari"; then
    echo -e "${GREEN}✓ Full Disk Access is currently ACTIVE for this environment.${RESET}"
else
    echo -e "${YELLOW}⚠️  Full Disk Access is NOT yet granted.${RESET}"
    echo -e "Without Full Disk Access, macOS will repeatedly show dialogs whenever"
    echo -e "terminal commands access ~/Downloads, ~/Documents, or ~/Desktop.\n"
fi

echo -e "${BOLD}2. Opening System Settings & Finder...${RESET}"
# Open System Settings directly to Full Disk Access
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"

# Reveal Termi.app in Finder
if [[ -d "$APP_PATH" ]]; then
    echo -e "${GREEN}✓ Found Termi at:${RESET} $APP_PATH"
    open -R "$APP_PATH"
    echo -e "\n${BOLD}${YELLOW}Action Required:${RESET}"
    echo -e " 1. Look at the ${BOLD}Full Disk Access${RESET} window in System Settings."
    echo -e " 2. If ${BOLD}Termi${RESET} is in the list, toggle the switch to ${GREEN}ON${RESET}."
    echo -e " 3. If ${BOLD}Termi${RESET} is not in the list, drag ${BOLD}Termi.app${RESET} from the Finder window into the list (or click '+')."
else
    echo -e "${YELLOW}Note: Termi.app was not found in /Applications.${RESET}"
    echo -e "Please install Termi.app to /Applications before configuring Full Disk Access."
fi

echo -e "\n${BOLD}3. Checking for Apple Development Code Signing Identities...${RESET}"
IDENTITIES=$(security find-identity -p codesigning -v 2>/dev/null | grep "Apple Development" || true)

if [[ -n "$IDENTITIES" ]]; then
    echo -e "${GREEN}✓ Found free Apple Development signing identity:${RESET}"
    echo "$IDENTITIES"
    FIRST_ID=$(echo "$IDENTITIES" | head -n 1 | awk -F '"' '{print $2}')
    echo -e "\n${CYAN}Tip:${RESET} You can permanently preserve Full Disk Access across updates by running:"
    echo -e "   ${BOLD}npm run app:sign:local${RESET}"
    echo -e "or:"
    echo -e "   ${BOLD}bash scripts/sign-local.sh \"$FIRST_ID\"${RESET}"
else
    echo -e "${YELLOW}ℹ️  No Apple Development identity found on this machine.${RESET}"
    echo -e "With ad-hoc signing, macOS may reset permissions after updates."
    echo -e "To make Full Disk Access permanently survive all future updates for free:"
    echo -e " 1. Open ${BOLD}Xcode${RESET} -> ${BOLD}Settings${RESET} (or Preferences) -> ${BOLD}Accounts${RESET}."
    echo -e " 2. Sign in with your free personal Apple ID (\$0, no developer account needed)."
    echo -e " 3. Xcode will create a free 'Personal Team' certificate."
    echo -e " 4. Run ${BOLD}npm run app:sign:local${RESET} to sign Termi with that certificate!"
fi

echo -e "\n${BOLD}${CYAN}======================================================${RESET}"
echo -e "${GREEN}Setup helper complete! Please toggle Termi in System Settings.${RESET}"
echo -e "${BOLD}${CYAN}======================================================${RESET}\n"
