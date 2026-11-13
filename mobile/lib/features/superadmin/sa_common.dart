import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/ui.dart';

StatusChip schoolStatusChip(Map<String, dynamic> s) {
  final status = '${s['status']}';
  final ouverte = s['ouverte'] != false;
  if (status == 'suspended') {
    return const StatusChip('Désactivée', AppColors.bad, icon: Icons.block);
  }
  if (!ouverte) {
    return const StatusChip('Abonnement expiré', AppColors.warn,
        icon: Icons.event_busy);
  }
  if (status == 'trial') {
    return const StatusChip('Essai', AppColors.info,
        icon: Icons.hourglass_bottom);
  }
  return const StatusChip('Active', AppColors.ok, icon: Icons.check_circle);
}

const planLabels = {
  'basic': 'Basic',
  'standard': 'Standard',
  'premium': 'Premium'
};
const modeLabels = {
  'especes': 'Espèces',
  'virement': 'Virement',
  'cheque': 'Chèque',
  'mobile_money': 'Mobile money'
};
