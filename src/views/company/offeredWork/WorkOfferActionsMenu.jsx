import React from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { FiMoreVertical } from "react-icons/fi";
import { Link } from "react-router-dom";

export default function WorkOfferActionsMenu({ title, items, disabled = false }) {
  return <Menu>
    <MenuButton
      disabled={disabled}
      aria-label={`Actions for ${title || "offered work"}`}
      title="Offer actions"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-theme bg-surface text-theme-muted transition hover:bg-surface-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50"
    >
      <FiMoreVertical className="h-5 w-5" aria-hidden="true" />
    </MenuButton>
    <MenuItems anchor={{ to: "bottom end", gap: 6, padding: 8 }} portal className="z-40 w-60 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-theme bg-surface p-1 text-left shadow-xl focus:outline-none">
      {items.map(({ id, label, icon: Icon, href, onClick, disabled: itemDisabled, destructive }) => <MenuItem key={id || label} disabled={itemDisabled}>
        {({ focus, disabled: unavailable }) => {
          const className = `flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-semibold transition ${focus ? "bg-surface-soft" : ""} ${destructive ? "text-red-700" : "text-theme-muted"} ${unavailable ? "cursor-not-allowed opacity-50" : ""}`;
          const content = <>{Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}<span>{label}</span></>;
          return href
            ? <Link to={href} className={className}>{content}</Link>
            : <button type="button" disabled={unavailable} onClick={onClick} className={className}>{content}</button>;
        }}
      </MenuItem>)}
    </MenuItems>
  </Menu>;
}
