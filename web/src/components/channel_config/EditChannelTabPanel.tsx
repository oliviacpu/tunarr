import Box from '@mui/material/Box';

export function EditChannelTabPanel(props: EditChannelTabPanelProps) {
  const { children, value, currentValue, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== currentValue}
      id={`simple-tabpanel-${currentValue}`}
      aria-labelledby={`simple-tab-${currentValue}`}
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
export type EditChannelTabs = 'properties' | 'flex' | 'epg' | 'ffmpeg';

export type EditChannelTabProps = {
  value: EditChannelTabs;
  description: string;
};
