import { useState, memo } from 'react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import * as Select from '@ariakit/react/select';
import { ChevronDown, FileText, LogOut } from 'lucide-react';
import { LinkIcon, GearIcon, Avatar } from '@librechat/client';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import FilesView from '~/components/Chat/Input/Files/FilesView';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import Settings from './Settings';
import store from '~/store';

function AccountSettings() {
  const localize = useLocalize();
  const { user, isAuthenticated, logout } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showFiles, setShowFiles] = useRecoilState(store.showFiles);
  const requestCloseRightSidePanel = useSetRecoilState(store.rightSidePanelCloseNonce);
  const displayName = user?.name ?? user?.username ?? localize('com_nav_user');
  const email = user?.email ?? localize('com_nav_user');
  const menuItemClass = cn(
    'group relative flex w-full select-item items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-text-primary transition-colors duration-150',
    'data-[active-item]:[background:var(--sidebar-item-hover)] data-[active-item]:text-text-primary',
  );
  const logoutItemClass = cn(
    menuItemClass,
    'text-red-600 dark:text-red-400 data-[active-item]:bg-red-500/10 data-[active-item]:text-red-700 dark:data-[active-item]:text-red-300',
  );

  return (
    <Select.SelectProvider>
      <Select.Select
        aria-label={localize('com_nav_account_settings')}
        data-testid="nav-user"
        className={cn(
          'group flex w-full items-center gap-2 rounded-xl border p-2 text-sm transition-all duration-200 ease-in-out',
          '[background:var(--sidebar-search-bg)] [border-color:var(--sidebar-shell-border)]',
          'hover:[background:var(--sidebar-item-hover)]',
        )}
      >
        <div className="ring-border-light/70 relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ring-1">
          <Avatar user={user} size={32} />
        </div>
        <div className="min-w-0 grow overflow-hidden text-left">
          <p className="truncate text-sm font-medium text-text-primary">{displayName}</p>
          <p className="truncate text-xs text-text-secondary">{email}</p>
        </div>
        <ChevronDown
          className="h-4 w-4 flex-shrink-0 text-text-secondary transition-transform duration-200 group-aria-expanded:rotate-180"
          aria-hidden="true"
        />
      </Select.Select>
      <Select.SelectPopover
        className={cn(
          'popover-ui w-[min(235px,calc(100vw-1rem))] rounded-2xl border p-1.5',
          '[border-color:var(--sidebar-shell-border)]',
          '[background:linear-gradient(165deg,var(--sidebar-shell-bg)_0%,var(--sidebar-shell-bg-alt)_62%,var(--sidebar-shell-bg)_100%)]',
          'shadow-[0_18px_38px_-30px_var(--sidebar-shell-glow)] backdrop-blur-md',
        )}
        style={{
          transformOrigin: 'bottom',
        }}
      >
        {/* <div
          className="mb-1 flex items-center gap-2 rounded-xl border px-2.5 py-2 [background:var(--sidebar-search-bg)] [border-color:var(--sidebar-shell-border)]"
          role="note"
        >
          <Avatar user={user} size={30} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text-primary">{displayName}</p>
            <p className="truncate text-xs text-text-secondary">{email}</p>
          </div>
        </div> */}
        {startupConfig?.balance?.enabled === true && balanceQuery.data != null && (
          <div
            className="mx-1 mb-1 flex items-center justify-between rounded-xl border px-2.5 py-2 [border-color:var(--sidebar-shell-border)] [background:var(--sidebar-footer-bg)]"
            role="note"
          >
            <span className="text-xs font-medium text-text-secondary">
              {localize('com_nav_balance')}
            </span>
            <span className="text-sm font-semibold text-text-primary">
              {new Intl.NumberFormat().format(Math.round(balanceQuery.data.tokenCredits))}
            </span>
          </div>
        )}
        <Select.SelectItem
          value="files"
          onClick={() => {
            requestCloseRightSidePanel((value) => value + 1);
            setShowFiles(true);
          }}
          className={menuItemClass}
        >
          <FileText className="icon-md text-text-secondary" aria-hidden="true" />
          {localize('com_nav_my_files')}
        </Select.SelectItem>
        {startupConfig?.helpAndFaqURL != null && startupConfig.helpAndFaqURL !== '/' && (
          <Select.SelectItem
            value="help"
            onClick={() => {
              requestCloseRightSidePanel((value) => value + 1);
              window.open(startupConfig.helpAndFaqURL, '_blank', 'noopener,noreferrer');
            }}
            className={menuItemClass}
          >
            <LinkIcon aria-hidden="true" />
            {localize('com_nav_help_faq')}
          </Select.SelectItem>
        )}
        <Select.SelectItem
          value="settings"
          onClick={() => {
            requestCloseRightSidePanel((value) => value + 1);
            setShowSettings(true);
          }}
          className={menuItemClass}
        >
          <GearIcon className="icon-md text-text-secondary" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Select.SelectItem>
        <div className="bg-border-light/70 mx-1 my-1 h-px" role="none" />
        <Select.SelectItem
          aria-selected={true}
          onClick={() => {
            requestCloseRightSidePanel((value) => value + 1);
            logout();
          }}
          value="logout"
          className={logoutItemClass}
        >
          <LogOut className="icon-md" />
          {localize('com_nav_log_out')}
        </Select.SelectItem>
      </Select.SelectPopover>
      {showFiles && <FilesView open={showFiles} onOpenChange={setShowFiles} />}
      {showSettings && <Settings open={showSettings} onOpenChange={setShowSettings} />}
    </Select.SelectProvider>
  );
}

export default memo(AccountSettings);
