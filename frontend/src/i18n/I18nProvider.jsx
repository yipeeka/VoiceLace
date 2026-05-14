import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  getLanguage,
  initializeLanguage,
  setLanguage as applyLanguage,
  subscribeLanguageChange,
  translate,
  translateUiText,
} from "./core";

const I18nContext = createContext({
  language: "zh",
  setLanguage: () => {},
  t: (text, params) => translate(text, params, "zh"),
});

function isInExplicitTree(element) {
  if (!element || typeof element.closest !== "function") return false;
  return Boolean(element.closest('[data-i18n-explicit="true"]'));
}

function translateTextNode(root, language, nodeMap) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (isInExplicitTree(node.parentElement)) {
      node = walker.nextNode();
      continue;
    }
    const original = nodeMap.get(node) || node.nodeValue;
    if (!nodeMap.has(node)) {
      nodeMap.set(node, original);
    }
    const trimmed = String(original || "").trim();
    if (trimmed) {
      const translated = translateUiText(original, language);
      if (translated !== node.nodeValue) {
        node.nodeValue = translated;
      }
    }
    node = walker.nextNode();
  }
}

function translateAttributes(root, language) {
  if (!root) return;
  const attributes = ["title", "placeholder", "aria-label", "aria-description"];
  const elements = root.querySelectorAll("*");
  elements.forEach((element) => {
    if (isInExplicitTree(element)) return;
    attributes.forEach((attr) => {
      if (!element.hasAttribute(attr)) return;
      const sourceAttr = `data-i18n-orig-${attr}`;
      const source = element.getAttribute(sourceAttr) || element.getAttribute(attr) || "";
      element.setAttribute(sourceAttr, source);
      const translated = translateUiText(source, language);
      if (element.getAttribute(attr) !== translated) {
        element.setAttribute(attr, translated);
      }
    });
  });
}

function installConfirmTranslation() {
  if (typeof window === "undefined" || window.__voicelaceConfirmI18nInstalled) return;
  const nativeConfirm = window.confirm.bind(window);
  window.confirm = (message) => nativeConfirm(translateUiText(String(message || ""), getLanguage()));
  window.__voicelaceConfirmI18nInstalled = true;
}

function useDomAutoTranslate(language) {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const nodeMap = new WeakMap();
    const apply = () => {
      translateTextNode(document.body, language, nodeMap);
      translateAttributes(document.body, language);
    };
    apply();
    const observer = new MutationObserver(() => apply());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [language]);
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => initializeLanguage());

  useEffect(() => {
    installConfirmTranslation();
  }, []);

  useEffect(() => subscribeLanguageChange(setLanguageState), []);
  useDomAutoTranslate(language);

  const value = useMemo(
    () => ({
      language,
      setLanguage: applyLanguage,
      t: (text, params) => translate(text, params, language),
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
