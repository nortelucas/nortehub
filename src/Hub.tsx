import React from "react";
import { motion } from "motion/react";
import { 
  FileText, 
  RefreshCw, 
  Lock, 
  ExternalLink, 
  ArrowRight, 
  Sparkles,
  Info,
  ShieldAlert,
  Settings,
  Link as LinkIcon,
  Box, Star, Wrench, Shield, Users, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HubLinkData } from "./Config";

interface HubProps {
  navigateTo: (view: 'hub' | 'ocr-perfis' | 'admin' | 'help' | 'users' | 'substitutions' | 'config') => void;
  hubLinks: HubLinkData[];
}

export function Hub({ navigateTo, hubLinks }: HubProps) {
  const activeLinks = hubLinks.filter(link => link.isActive);
  const count = activeLinks.length;

  // Dynamically calculate grid columns, gaps, paddings and text sizes depending on the link count
  let gridColsClass = "grid-cols-1 md:grid-cols-3";
  let maxContainerWidth = "max-w-5xl";
  let cardPaddingClass = "p-5 md:p-6 pb-3";
  let contentPaddingClass = "p-5 md:p-6 pt-0 flex-1";
  let footerPaddingClass = "p-5 md:p-6 pt-3";
  let iconContainerClass = "w-10 h-10 rounded-xl";
  let iconClass = "w-5 h-5";
  let titleClass = "text-lg md:text-xl";
  let descClass = "text-slate-350 text-xs md:text-sm";
  let btnClass = "h-10 text-sm";
  let badgeClass = "text-[10px] px-2 py-0.5";
  let gapClass = "gap-5 lg:gap-6";

  if (count === 1) {
    gridColsClass = "grid-cols-1";
    maxContainerWidth = "max-w-md";
  } else if (count === 2) {
    gridColsClass = "grid-cols-1 sm:grid-cols-2";
    maxContainerWidth = "max-w-3xl";
  } else if (count === 3) {
    gridColsClass = "grid-cols-1 md:grid-cols-3";
    maxContainerWidth = "max-w-5xl";
  } else if (count === 4) {
    gridColsClass = "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
    maxContainerWidth = "max-w-6xl";
    cardPaddingClass = "p-4 md:p-5 pb-2";
    contentPaddingClass = "p-4 md:p-5 pt-0 flex-1";
    footerPaddingClass = "p-4 md:p-5 pt-2.5";
    iconContainerClass = "w-9 h-9 rounded-lg";
    iconClass = "w-4 h-4";
    titleClass = "text-base md:text-lg";
    descClass = "text-slate-350 text-xs";
    btnClass = "h-9 text-xs";
    badgeClass = "text-[9px] px-1.5 py-0";
    gapClass = "gap-4 lg:gap-5";
  } else if (count <= 6) {
    gridColsClass = "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6";
    maxContainerWidth = "max-w-7xl";
    cardPaddingClass = "p-4 pb-2";
    contentPaddingClass = "p-4 pt-0 flex-1";
    footerPaddingClass = "p-4 pt-2.5";
    iconContainerClass = "w-9 h-9 rounded-lg";
    iconClass = "w-4 h-4";
    titleClass = "text-base md:text-lg";
    descClass = "text-slate-350 text-xs";
    btnClass = "h-9 text-xs";
    badgeClass = "text-[9px] px-1.5 py-0";
    gapClass = "gap-4";
  } else {
    // 7 or more links (super compact layout to avoid scrolling as much as possible)
    gridColsClass = "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
    maxContainerWidth = "max-w-7xl";
    cardPaddingClass = "p-3.5 md:p-4 pb-1.5";
    contentPaddingClass = "p-3.5 md:p-4 pt-0 flex-1";
    footerPaddingClass = "p-3.5 md:p-4 pt-2";
    iconContainerClass = "w-8 h-8 rounded-md";
    iconClass = "w-4 h-4";
    titleClass = "text-sm md:text-base";
    descClass = "text-slate-350 text-[11px] leading-snug";
    btnClass = "h-8 text-xs";
    badgeClass = "text-[8px] px-1 py-0";
    gapClass = "gap-3";
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { 
      opacity: 1, 
      y: 0, 
      transition: { 
        type: "spring", 
        stiffness: 100, 
        damping: 15 
      } 
    },
  };

  const renderIcon = (name: string, className: string) => {
    switch (name) {
      case "FileText": return <FileText className={className} />;
      case "Lock": return <Lock className={className} />;
      case "RefreshCw": return <RefreshCw className={className} />;
      case "Link": return <LinkIcon className={className} />;
      case "Settings": return <Settings className={className} />;
      case "Box": return <Box className={className} />;
      case "Star": return <Star className={className} />;
      case "Wrench": return <Wrench className={className} />;
      case "Shield": return <Shield className={className} />;
      case "Users": return <Users className={className} />;
      case "Info": return <Info className={className} />;
      case "AlertCircle": return <AlertCircle className={className} />;
      default: return <LinkIcon className={className} />;
    }
  };

  const getColorClasses = (color: string) => {
    switch (color) {
      case 'primary': return { text: 'text-primary', bgOpacity: 'bg-primary/10', from: 'from-primary', to: 'to-orange-500', shadow: 'hover:shadow-[0_0_30px_rgba(244,121,32,0.15)]', border: 'hover:border-primary/50', btnBg: 'bg-primary', btnHover: 'hover:bg-primary/95', btnShadow: 'shadow-primary/20', hoverIconBg: 'group-hover:bg-primary', badgeBg: 'bg-emerald-500/10', badgeText: 'text-emerald-400', badgeBorder: 'border-emerald-500/20' };
      case 'blue': return { text: 'text-blue-400', bgOpacity: 'bg-blue-50/5', from: 'from-blue-500', to: 'to-indigo-600', shadow: 'hover:shadow-[0_0_30px_rgba(59,130,246,0.15)]', border: 'hover:border-blue-500/50', btnBg: 'bg-blue-600', btnHover: 'hover:bg-blue-500', btnShadow: 'shadow-blue-600/20', hoverIconBg: 'group-hover:bg-blue-500', badgeBg: 'bg-blue-500/10', badgeText: 'text-blue-400', badgeBorder: 'border-blue-500/20' };
      case 'green': return { text: 'text-emerald-400', bgOpacity: 'bg-emerald-500/10', from: 'from-emerald-500', to: 'to-green-600', shadow: 'hover:shadow-[0_0_30px_rgba(16,185,129,0.15)]', border: 'hover:border-emerald-500/50', btnBg: 'bg-emerald-600', btnHover: 'hover:bg-emerald-500', btnShadow: 'shadow-emerald-600/20', hoverIconBg: 'group-hover:bg-emerald-500', badgeBg: 'bg-emerald-500/10', badgeText: 'text-emerald-400', badgeBorder: 'border-emerald-500/20' };
      case 'slate': return { text: 'text-slate-400', bgOpacity: 'bg-slate-800', from: 'from-slate-600', to: 'to-slate-700', shadow: '', border: 'hover:border-slate-700/50', btnBg: 'bg-slate-800', btnHover: 'hover:bg-slate-700', btnShadow: 'shadow-slate-900/20', hoverIconBg: 'group-hover:bg-slate-700', badgeBg: 'bg-slate-800', badgeText: 'text-slate-400', badgeBorder: 'border-slate-700' };
      case 'purple': return { text: 'text-purple-400', bgOpacity: 'bg-purple-500/10', from: 'from-purple-500', to: 'to-fuchsia-600', shadow: 'hover:shadow-[0_0_30px_rgba(168,85,247,0.15)]', border: 'hover:border-purple-500/50', btnBg: 'bg-purple-600', btnHover: 'hover:bg-purple-500', btnShadow: 'shadow-purple-600/20', hoverIconBg: 'group-hover:bg-purple-500', badgeBg: 'bg-purple-500/10', badgeText: 'text-purple-400', badgeBorder: 'border-purple-500/20' };
      default: return { text: 'text-primary', bgOpacity: 'bg-primary/10', from: 'from-primary', to: 'to-orange-500', shadow: 'hover:shadow-[0_0_30px_rgba(244,121,32,0.15)]', border: 'hover:border-primary/50', btnBg: 'bg-primary', btnHover: 'hover:bg-primary/95', btnShadow: 'shadow-primary/20', hoverIconBg: 'group-hover:bg-primary', badgeBg: 'bg-emerald-500/10', badgeText: 'text-emerald-400', badgeBorder: 'border-emerald-500/20' };
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between overflow-x-hidden relative font-sans">
      {/* Decorative Glowing Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-orange-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-orange-600/5 blur-[150px] pointer-events-none" />
      <div className="absolute top-[30%] right-[20%] w-[30%] h-[30%] rounded-full bg-blue-600/5 blur-[120px] pointer-events-none" />

      {/* Grid Pattern Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

      {/* Main Content Area */}
      <div className="flex-1 w-full max-w-7xl mx-auto px-4 py-8 md:py-12 z-10 flex flex-col justify-center">
        {/* Portal Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center space-y-3 mb-8 md:mb-10 relative"
        >
          <div className="absolute top-0 right-0">
            <Button variant="ghost" size="icon" onClick={() => navigateTo('config')} className="text-slate-400 hover:text-white hover:bg-slate-800 w-8 h-8">
              <Settings className="w-4 h-4" />
            </Button>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-[10px] font-semibold tracking-wider uppercase mb-1">
            <Sparkles className="w-3 h-3" />
            Portal de Aplicações
          </div>
          
          <div className="flex justify-center mb-2">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Aluminorte Logo"
              className="h-10 md:h-12 object-contain drop-shadow-[0_0_15px_rgba(244,121,32,0.15)]"
            />
          </div>
          
          <p className="text-slate-400 text-xs md:text-sm max-w-lg mx-auto">
            Acesse as ferramentas operacionais da Aluminorte de forma centralizada e ágil.
          </p>
        </motion.div>

        {/* Action Grid */}
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className={`grid ${gridColsClass} ${gapClass} items-stretch ${maxContainerWidth} mx-auto w-full`}
        >
          {activeLinks.map(link => {
            const colors = getColorClasses(link.themeColor);
            const isLocked = link.url === "#";
            
            return (
              <motion.div key={link.id} variants={itemVariants} className="h-full">
                <Card className={`group h-full bg-slate-900/40 backdrop-blur-md border-slate-800/80 rounded-2xl overflow-hidden flex flex-col justify-between relative transition-all duration-300 ${isLocked ? 'opacity-60' : `${colors.border} ${colors.shadow}`}`}>
                  <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${colors.from} ${colors.to} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                  
                  <CardHeader className={cardPaddingClass}>
                    <div className="flex items-center justify-between mb-4">
                      <div className={`${iconContainerClass} ${colors.bgOpacity} ${colors.text} flex items-center justify-center transition-all duration-300 shadow-inner ${!isLocked ? `group-hover:scale-105 ${colors.hoverIconBg} group-hover:text-white` : 'border border-slate-800'}`}>
                        {renderIcon(link.iconName, iconClass)}
                      </div>
                      {link.subtitle && (
                        <Badge className={`${colors.badgeBg} ${colors.badgeText} border ${colors.badgeBorder} font-semibold rounded-full ${badgeClass}`}>
                          {link.subtitle}
                        </Badge>
                      )}
                    </div>
                    
                    <CardTitle className={`${titleClass} font-bold text-white mb-1 transition-colors ${!isLocked && `group-hover:${colors.text}`}`}>
                      {link.title}
                    </CardTitle>
                  </CardHeader>
                  
                  <CardContent className={contentPaddingClass}>
                    <p className={`${descClass} leading-relaxed whitespace-pre-wrap`}>
                      {link.description}
                    </p>
                  </CardContent>
                  
                  <CardFooter className={`${footerPaddingClass} border-t border-slate-800/30 bg-slate-950/20 flex flex-col gap-2.5`}>
                    {isLocked ? (
                      <Button disabled className={`w-full ${colors.btnBg} ${colors.text} border border-slate-800 font-bold ${btnClass} rounded-xl flex items-center justify-center gap-2 cursor-not-allowed`}>
                        <Lock className="w-3.5 h-3.5" />
                        Em breve
                      </Button>
                    ) : (
                      <>
                        {link.isExternal ? (
                          <a href={link.url} target="_blank" rel="noopener noreferrer" className="w-full">
                            <Button className={`w-full ${colors.btnBg} ${colors.btnHover} text-white font-bold ${btnClass} rounded-xl shadow-lg ${colors.btnShadow} transition-all flex items-center justify-center gap-2 cursor-pointer`}>
                              Acessar Portal
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </a>
                        ) : link.url.startsWith('http') ? (
                          <a href={link.url} target="_self" className="w-full">
                            <Button className={`w-full ${colors.btnBg} ${colors.btnHover} text-white font-bold ${btnClass} rounded-xl shadow-lg ${colors.btnShadow} transition-all flex items-center justify-center gap-2 cursor-pointer`}>
                              Abrir Ferramenta
                              <ArrowRight className="w-4 h-4" />
                            </Button>
                          </a>
                        ) : (
                          <Button 
                            onClick={() => navigateTo(link.url as any)}
                            className={`w-full ${colors.btnBg} ${colors.btnHover} text-white font-bold ${btnClass} rounded-xl shadow-lg ${colors.btnShadow} transition-all flex items-center justify-center gap-2 cursor-pointer`}
                          >
                            Abrir Ferramenta
                            <ArrowRight className="w-4 h-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </CardFooter>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* Portal Footer */}
      <footer className="w-full max-w-7xl mx-auto px-4 py-8 border-t border-slate-900/60 z-10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500 text-center md:text-left">
        <p>© 2026 Aluminorte. Todos os direitos reservados.</p>
        <div className="flex items-center gap-1.5 justify-center md:justify-start">
          <ShieldAlert className="w-4 h-4 text-primary" />
          <span>Área corporativa de uso restrito.</span>
        </div>
      </footer>
    </div>
  );
}
