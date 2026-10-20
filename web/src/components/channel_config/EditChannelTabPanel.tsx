import Box from '@mui/material/Box';

export function EditChannelTabPanel(props: EditChannelTabPanelProps) {
  const { children, value, currentValue, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== currentValue}
      id={`channel-tabpanel-${value}`}
      aria-labelledby={`channel-tab-${value}`}
      {...other}
    >
      {value === currentValue && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}
interface EditChannelTabPanelProps {
  children?: React.ReactNode;
  currentValue: EditChannelTabs;
  value: EditChannelTabs;
}
export type EditChannelTabs =
  | 'properties'
  | 'flex'
  | 'guide'
  | 'streaming'
  | 'watermark';
