import React, { createContext, useContext } from 'react';

type RightSidePanelContextValue = {
  isSidePanelOpen: boolean;
  openSidePanel: () => void;
  closeSidePanel: () => void;
  toggleSidePanel: () => void;
};

const defaultContextValue: RightSidePanelContextValue = {
  isSidePanelOpen: false,
  openSidePanel: () => {},
  closeSidePanel: () => {},
  toggleSidePanel: () => {},
};

const RightSidePanelContext = createContext<RightSidePanelContextValue>(defaultContextValue);

export function RightSidePanelProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: RightSidePanelContextValue;
}) {
  return <RightSidePanelContext.Provider value={value}>{children}</RightSidePanelContext.Provider>;
}

export function useRightSidePanel() {
  return useContext(RightSidePanelContext);
}
