import 'package:flutter/material.dart';

/// Clés globales : navigation et bandeaux depuis un service (notification reçue ou ouverte) sans `BuildContext`.
final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<ScaffoldMessengerState> appMessengerKey =
    GlobalKey<ScaffoldMessengerState>();
