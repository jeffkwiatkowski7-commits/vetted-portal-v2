import React from 'react';

const BADGE_COLORS: Record<string, string> = {
  pdf: '#e74c3c',
  xls: '#1e7e34',
  xlsx: '#1e7e34',
  csv: '#1e7e34',
  doc: '#2980b9',
  docx: '#2980b9',
  txt: '#7f8c8d',
  md: '#7f8c8d',
  png: '#8e44ad',
  jpg: '#8e44ad',
  jpeg: '#8e44ad',
  gif: '#8e44ad',
};

function getBadgeColor(fileType: string): string {
  return BADGE_COLORS[fileType.toLowerCase()] ?? '#555555';
}

interface FileTypeBadgeProps {
  fileType: string;
  size?: number;
}

export default function FileTypeBadge({ fileType, size = 20 }: FileTypeBadgeProps) {
  const label = fileType.toUpperCase().slice(0, 3);
  const bg = getBadgeColor(fileType);
  const fontSize = size <= 16 ? 6 : 7;

  return (
    <div
      style={{
        width: size,
        height: size,
        background: bg,
        borderRadius: 3,
        fontSize,
        fontWeight: 700,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}
