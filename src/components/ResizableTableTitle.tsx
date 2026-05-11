"use client";

import type { HTMLAttributes, SyntheticEvent } from "react";
import type { ResizeCallbackData } from "react-resizable";
import { Resizable } from "react-resizable";
import "react-resizable/css/styles.css";

type Props = HTMLAttributes<HTMLTableHeaderCellElement> & {
  width?: number;
  onResize?: (e: SyntheticEvent, data: ResizeCallbackData) => void;
};

/** Ant Design Table `components.header.cell`，配合列 `onHeaderCell` 使用 */
export function ResizableTableTitle(props: Props) {
  const { onResize, width, children, style, ...rest } = props;
  if (width == null || !onResize) {
    return (
      <th {...rest} style={{ ...style, position: "relative" }}>
        {children}
      </th>
    );
  }
  return (
    <Resizable
      width={width}
      height={0}
      minConstraints={[48, 0]}
      maxConstraints={[800, 0]}
      handle={
        <span
          className="react-resizable-handle"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            top: 0,
            width: 6,
            cursor: "col-resize",
            zIndex: 1,
          }}
        />
      }
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...rest} style={{ ...style, position: "relative" }}>
        {children}
      </th>
    </Resizable>
  );
}
