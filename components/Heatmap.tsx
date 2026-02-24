import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { MatrixCell } from '../types';

interface HeatmapProps {
  data: MatrixCell[];
  width?: number;
  height?: number;
  onClick?: (cell: MatrixCell) => void;
  onHover?: (cell: MatrixCell | null) => void;
  valueLabel?: string;
  valueFormatter?: (value: number) => string;
  valueDomain?: [number, number];
  showCellValues?: boolean;
  focusRow?: string | null;
  focusCol?: string | null;
}

export const Heatmap: React.FC<HeatmapProps> = ({
  data,
  width = 600,
  height = 600,
  onClick,
  onHover,
  valueLabel = 'Value',
  valueFormatter,
  valueDomain,
  showCellValues,
  focusRow,
  focusCol,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    const margin = { top: 96, right: 20, bottom: 24, left: 96 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    // Extract unique rows and columns
    const myGroups = Array.from(new Set(data.map(d => d.col)));
    const myVars = Array.from(new Set(data.map(d => d.row)));
    const maxXTicks = Math.max(4, Math.floor(w / 62));
    const maxYTicks = Math.max(4, Math.floor(h / 22));
    const xStep = Math.max(1, Math.ceil(myGroups.length / maxXTicks));
    const yStep = Math.max(1, Math.ceil(myVars.length / maxYTicks));
    const xTickValues = myGroups.filter((_, idx) => idx % xStep === 0 || idx === myGroups.length - 1);
    const yTickValues = myVars.filter((_, idx) => idx % yStep === 0 || idx === myVars.length - 1);

    // Scales
    const x = d3.scaleBand().range([0, w]).domain(myGroups).padding(0.05);
    const y = d3.scaleBand().range([h, 0]).domain(myVars).padding(0.05);

    const minValue = d3.min(data, d => d.value) ?? 0;
    const maxValue = d3.max(data, d => d.value) ?? 1;
    const domainMin = valueDomain ? valueDomain[0] : minValue;
    const domainMax = valueDomain ? valueDomain[1] : maxValue;
    const safeMin = domainMin === domainMax ? domainMin - 1 : domainMin;
    const safeMax = domainMin === domainMax ? domainMax + 1 : domainMax;
    const midValue = (safeMin + safeMax) / 2;

    // Color Scale: Red (low) -> Yellow (mid) -> Green (high)
    const myColor = d3.scaleLinear<string>()
        .range(["#f87171", "#facc15", "#4ade80"])
        .domain([safeMin, midValue, safeMax]);

    const formatValue = valueFormatter ?? ((value: number) => value.toFixed(2));
    const uiFont = '"Avenir Next","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei","Segoe UI Variable","IBM Plex Sans",sans-serif';

    // Add X Axis
    const xAxisGroup = g.append("g")
      .attr("transform", `translate(0, -10)`)
      .call(d3.axisTop(x).tickSize(0).tickValues(xTickValues));
    xAxisGroup.select(".domain").remove();
    const xTicks = xAxisGroup.selectAll<SVGTextElement, string>("text")
      .style("font-size", "12px")
      .style("font-family", uiFont)
      .style("font-weight", "500")
      .style("fill", d => (focusCol && d === focusCol ? "#1d4ed8" : "#475569"));
    const shouldTiltXTicks = xStep > 1 || myGroups.some(label => String(label).length > 10);
    if (shouldTiltXTicks) {
      xTicks
        .style("text-anchor", "end")
        .attr("transform", "rotate(-35)")
        .attr("dx", "-0.3em")
        .attr("dy", "-0.25em");
    }
    if (focusCol) {
      xTicks
        .style("font-weight", d => (d === focusCol ? "700" : "500"))
        .style("opacity", d => (d === focusCol ? "1" : "0.5"));
    }

    // Add Y Axis
    const yAxisGroup = g.append("g").call(d3.axisLeft(y).tickSize(0).tickValues(yTickValues));
    yAxisGroup.select(".domain").remove();
    const yTicks = yAxisGroup.selectAll<SVGTextElement, string>("text")
      .style("font-size", "12px")
      .style("font-family", uiFont)
      .style("font-weight", "500")
      .style("fill", d => (focusRow && d === focusRow ? "#1d4ed8" : "#475569"));
    if (focusRow) {
      yTicks
        .style("font-weight", d => (d === focusRow ? "700" : "500"))
        .style("opacity", d => (d === focusRow ? "1" : "0.5"));
    }

    // Tooltip
    const tooltip = d3.select("body").append("div")
        .style("opacity", 0)
        .attr("class", "absolute bg-gray-900 text-white text-xs px-2 py-1 rounded pointer-events-none shadow-lg z-50");

    // Squares
    g.selectAll()
      .data(data, (d: any) => d.col + ':' + d.row)
      .enter()
      .append("rect")
      .attr("x", (d) => x(d.col) || 0)
      .attr("y", (d) => y(d.row) || 0)
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .style("fill", (d) => myColor(d.value))
      .style("stroke-width", 4)
      .style("stroke", "none")
      .style("opacity", (d) => {
        if (!focusRow && !focusCol) return 0.82;
        return d.row === focusRow || d.col === focusCol ? 1 : 0.22;
      })
      .style("cursor", onClick ? "pointer" : "default")
      .on("mouseover", function(event, d) {
        d3.select(this).style("stroke", "#0f172a").style("opacity", 1);
        tooltip.style("opacity", 1);
        tooltip.html(`Row: ${d.row}<br>Col: ${d.col}<br>${valueLabel}: ${formatValue(d.value)}`)
               .style("left", (event.pageX + 10) + "px")
               .style("top", (event.pageY + 10) + "px");
        if (onHover) onHover(d);
      })
      .on("mousemove", function(event) {
        tooltip.style("left", (event.pageX + 10) + "px")
               .style("top", (event.pageY + 10) + "px");
      })
      .on("mouseleave", function() {
        d3.select(this)
          .style("stroke", "none")
          .style("opacity", (d: unknown) => {
            const cell = d as MatrixCell;
            if (!focusRow && !focusCol) return 0.82;
            return cell.row === focusRow || cell.col === focusCol ? 1 : 0.22;
          });
        tooltip.style("opacity", 0);
        if (onHover) onHover(null);
      })
      .on("click", function(event, d) {
          if (onClick) onClick(d);
      });

    const shouldShowCellValues = typeof showCellValues === 'boolean' ? showCellValues : data.length <= 900;
    if (shouldShowCellValues) {
      // Add text labels inside squares only when matrix size is moderate.
      g.selectAll()
        .data(data)
        .enter()
        .append("text")
        .text((d) => formatValue(d.value))
        .attr("x", (d) => (x(d.col) || 0) + x.bandwidth() / 2)
        .attr("y", (d) => (y(d.row) || 0) + y.bandwidth() / 2)
        .style("text-anchor", "middle")
        .style("alignment-baseline", "middle")
        .style("font-size", "10px")
        .style("font-family", uiFont)
        .style("fill", "#1e293b")
        .style("pointer-events", "none");
    }

    return () => {
        tooltip.remove();
    };

  }, [data, width, height, onClick, onHover, valueLabel, valueFormatter, valueDomain, showCellValues, focusRow, focusCol]);

  return (
    <div className="flex justify-center bg-white p-4 rounded-lg shadow-sm border border-gray-100">
      <svg ref={svgRef} width={width} height={height} />
    </div>
  );
};
