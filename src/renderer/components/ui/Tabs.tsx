/**
 * Tabs — tab bar for switching views.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onTabChange, className }) => (
  <div className={cn(s.tabs, className)}>
    {tabs.map((tab) => (
      <button key={tab.id} className={activeTab === tab.id ? s.tabActive : s.tab} onClick={() => onTabChange(tab.id)}>
        {tab.label}
      </button>
    ))}
  </div>
);
