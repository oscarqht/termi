#!/bin/bash
set -e

# ==============================================================================
# scripts/export-apple-cert.sh
# Helper to prepare your Apple Certificate for GitHub Actions Secrets
# ==============================================================================

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}======================================================${RESET}"
echo -e "${BOLD}${CYAN}   Apple Certificate GitHub Actions Preparation Tool  ${RESET}"
echo -e "${BOLD}${CYAN}======================================================${RESET}\n"

RAW_IDENTITIES=$(security find-identity -p codesigning -v 2>/dev/null | grep "Apple Development" || true)

if [[ -z "$RAW_IDENTITIES" ]]; then
    # Check if identity exists in keychain but lacks intermediate CA
    NON_V=$(security find-identity -p codesigning 2>/dev/null | grep "Apple Development" || true)
    if [[ -n "$NON_V" ]]; then
        echo -e "${CYAN}Installing missing Apple WWDR Intermediate Certificate...${RESET}"
        curl -fsSL https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer -o /tmp/AppleWWDRCAG3.cer 2>/dev/null || true
        security add-certificates -k ~/Library/Keychains/login.keychain-db /tmp/AppleWWDRCAG3.cer 2>/dev/null || true
        RAW_IDENTITIES=$(security find-identity -p codesigning -v 2>/dev/null | grep "Apple Development" || true)
    fi
fi

P12_FILE="$1"

if [[ -z "$RAW_IDENTITIES" && -z "$P12_FILE" ]]; then
    echo -e "${YELLOW}No Apple Development signing identity was detected in Keychain.${RESET}\n"
    echo -e "Please first create your free certificate in Xcode:"
    echo -e "  1. Open Xcode -> Settings -> Accounts."
    echo -e "  2. Select your Personal Apple ID -> Personal Team."
    echo -e "  3. Click Manage Certificates... -> [+] -> Apple Development."
    echo -e "  4. Click Done, then re-run this script."
    exit 1
fi

if [[ -n "$RAW_IDENTITIES" ]]; then
    echo -e "${GREEN}✓ Found Apple Development identity in Keychain:${RESET}"
    echo "$RAW_IDENTITIES"
    FIRST_IDENTITY=$(echo "$RAW_IDENTITIES" | head -n 1 | awk -F '"' '{print $2}')
else
    FIRST_IDENTITY="Apple Development: <your_email> (<team_id>)"
fi

if [[ -z "$P12_FILE" ]]; then
    echo -e "\n${BOLD}${YELLOW}How to export your certificate as .p12:${RESET}"
    echo -e " 1. Open the ${BOLD}Keychain Access${RESET} app on your Mac."
    echo -e " 2. In the left sidebar, click ${BOLD}login${RESET} under Keychains, and ${BOLD}My Certificates${RESET} under Category."
    echo -e " 3. Locate your ${BOLD}Apple Development: ...${RESET} certificate."
    echo -e " 4. Right-click it and choose ${BOLD}Export \"Apple Development: ...\"${RESET}"
    echo -e " 5. Save it as ${BOLD}certificate.p12${RESET} and choose an export password."
    echo -e " 6. Run this command with your file:"
    echo -e "    ${BOLD}npm run app:export-cert -- ./certificate.p12${RESET}\n"
    exit 0
fi

if [[ ! -f "$P12_FILE" ]]; then
    echo -e "${RED}Error: File not found at $P12_FILE${RESET}"
    exit 1
fi

# Convert to Base64 and copy to clipboard
if command -v pbcopy >/dev/null 2>&1; then
    openssl base64 -A -in "$P12_FILE" | pbcopy
    echo -e "\n${BOLD}${GREEN}✓ Successfully encoded and copied certificate to your clipboard!${RESET}\n"
else
    echo -e "\n${BOLD}${GREEN}✓ Successfully encoded certificate:${RESET}\n"
    openssl base64 -A -in "$P12_FILE"
fi

echo -e "${BOLD}${CYAN}Now add these 3 Secrets in GitHub:${RESET}"
echo -e "Go to: ${BOLD}GitHub Repo -> Settings -> Secrets and variables -> Actions -> New repository secret${RESET}\n"
echo -e " 1. Name:  ${BOLD}APPLE_CERTIFICATE${RESET}"
echo -e "    Value: [Already in your clipboard! Just press Cmd+V to paste]\n"
echo -e " 2. Name:  ${BOLD}APPLE_CERTIFICATE_PASSWORD${RESET}"
echo -e "    Value: [The password you entered when exporting the .p12]\n"
echo -e " 3. Name:  ${BOLD}APPLE_SIGNING_IDENTITY${RESET}"
echo -e "    Value: ${GREEN}$FIRST_IDENTITY${RESET}\n"
echo -e "${BOLD}${GREEN}======================================================${RESET}"
echo -e "${BOLD}${GREEN}All set! Your GitHub Action builds will now be signed!${RESET}"
echo -e "${BOLD}${GREEN}======================================================${RESET}\n"
