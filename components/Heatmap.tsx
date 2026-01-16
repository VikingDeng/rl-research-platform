import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { MatrixCell } from '../types';

interface HeatmapProps {
  data: MatrixCell[];
  width?: number;
  height?: number;
  onClick?: (cell: MatrixCell) => void;
  valueLabel?: string;
  valueFormatter?: (value: number) => string;
  valueDomain?: [number, number];
}

export const Heatmap: React.FC<HeatmapProps> = ({
  data,
  width = 600,
  height = 600,
  onClick,
  valueLabel = 'Value',
  valueFormatter,
  valueDomain,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    const margin = { top: 80, right: 20, bottom: 20, left: 80 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    // Extract unique rows and columns
    const myGroups = Array.from(new Set(data.map(d => d.col)));
    const myVars = Array.from(new Set(data.map(d => d.row)));

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

    // Add X Axis
    g.append("g")
      .attr("transform", `translate(0, -10)`)
      .call(d3.axisTop(x).tickSize(0))
      .select(".domain").remove();
      
    g.selectAll("text")
       .style("font-size", "12px")
       .style("font-family", "Inter")
       .style("font-weight", "500");

    // Add Y Axis
    g.append("g")
      .call(d3.axisLeft(y).tickSize(0))
      .select(".domain").remove();

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
      .style("opacity", 0.8)
      .style("cursor", onClick ? "pointer" : "default")
      .on("mouseover", function(event, d) {
        d3.select(this).style("stroke", "black").style("opacity", 1);
        tooltip.style("opacity", 1);
        tooltip.html(`Row: ${d.row}<br>Col: ${d.col}<br>${valueLabel}: ${formatValue(d.value)}`)
               .style("left", (event.pageX + 10) + "px")
               .style("top", (event.pageY + 10) + "px");
      })
      .on("mousemove", function(event) {
        tooltip.style("left", (event.pageX + 10) + "px")
               .style("top", (event.pageY + 10) + "px");
      })
      .on("mouseleave", function() {
        d3.select(this).style("stroke", "none").style("opacity", 0.8);
        tooltip.style("opacity", 0);
      })
      .on("click", function(event, d) {
          if (onClick) onClick(d);
      });

      // Add text labels inside squares
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
        .style("fill", "#1e293b")
        .style("pointer-events", "none");

    return () => {
        tooltip.remove();
    };

  }, [data, width, height, onClick]);

  return (
    <div className="flex justify-center bg-white p-4 rounded-lg shadow-sm border border-gray-100">
      <svg ref={svgRef} width={width} height={height} />
    </div>
  );
};
